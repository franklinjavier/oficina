import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { findSecretHits, looksLikeSecret, sanitizeJson, sanitizeText } from "./secrets.ts";

export type CliArgs = {
  from: string;
  name: string;
  out: string;
  dryRun: boolean;
};

export type ExportError =
  | { kind: "usage"; message: string }
  | { kind: "credentials"; message: string; findings: string[] }
  | { kind: "io"; message: string }
  | { kind: "reserved"; message: string }
  | { kind: "empty"; message: string };

export type Result<T, E = ExportError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export type RegistryFile = {
  path: string;
  type: "registry:file";
  target: string;
};

export type ExportReport = {
  name: string;
  type: "registry:block";
  dryRun: boolean;
  files: RegistryFile[];
  agents: string[];
};

type AgentSource = {
  slug: string;
  root: string;
  title: string;
  description: string;
};

type PlannedFile = {
  relativePath: string;
  target: string;
  contents: Buffer;
};

const RESERVED_NAMES = new Set(["orchestrator"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SKIP_DIRS = new Set([
  "memory",
  "transcripts",
  "conversations",
  "conversation",
  "node_modules",
  ".git",
]);

const CREDENTIAL_DIRS = new Set(["credentials"]);
const CREDENTIAL_FILES = new Set(["factory.db", "store.db", "id_rsa"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".cjs",
  ".svg",
  ".toml",
  ".ts",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const BINARY_AVATAR_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);

export function parseArgs(argv: string[]): Result<CliArgs> {
  let from: string | undefined;
  let name: string | undefined;
  let out: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--from":
      case "-f":
        from = next;
        index += 1;
        break;
      case "--name":
      case "-n":
        name = next;
        index += 1;
        break;
      case "--out":
      case "-o":
        out = next;
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        return {
          ok: false,
          error: {
            kind: "usage",
            message: usageText(),
          },
        };
      default:
        return {
          ok: false,
          error: {
            kind: "usage",
            message: `Unknown argument: ${arg}\n\n${usageText()}`,
          },
        };
    }
  }

  if (
    from == null ||
    from === "" ||
    name == null ||
    name === "" ||
    out == null ||
    out === ""
  ) {
    return {
      ok: false,
      error: {
        kind: "usage",
        message: `Missing required --from, --name, and --out.\n\n${usageText()}`,
      },
    };
  }

  return { ok: true, data: { from, name, out, dryRun } };
}

export function usageText(): string {
  return [
    "Export a sanitized Grok Bot factory as a shadcn registry:block.",
    "",
    "  npx tsx scripts/export-factory.ts --from <path> --name <slug> --out <their-registry-repo>",
    "",
    "  --from      One agent folder (profile.json) or a parent of many agents",
    "  --name      Registry item slug to write",
    "  --out       Your registry repo root. Required. Do not write into this tool repo.",
    "  --dry-run   Print the planned block and write nothing",
  ].join("\n");
}

export async function exportFactory(args: CliArgs): Promise<Result<ExportReport>> {
  const name = args.name.trim().toLowerCase();
  if (!SLUG_PATTERN.test(name)) {
    return {
      ok: false,
      error: {
        kind: "usage",
        message: `Invalid --name "${args.name}". Use a lowercase kebab slug such as newsroom.`,
      },
    };
  }
  const from = path.resolve(args.from);
  const out = path.resolve(args.out);
  const catalogPath = path.join(out, "registry.json");
  const existingCatalog = await readCatalog(catalogPath, name);
  if (RESERVED_NAMES.has(name) && catalogHasItem(existingCatalog, name)) {
    return {
      ok: false,
      error: {
        kind: "reserved",
        message:
          "Refusing to overwrite the fictional orchestrator item. Pick another --name.",
      },
    };
  }

  const sourceCheck = await inspectSource(from);
  if (!sourceCheck.ok) return sourceCheck;

  const agents = await discoverAgents(from);
  if (agents.length === 0) {
    return {
      ok: false,
      error: {
        kind: "empty",
        message: `No agent folders with profile.json under ${from}`,
      },
    };
  }

  const planned: PlannedFile[] = [];
  const findings: string[] = [];

  for (const agent of agents) {
    const prefix = agents.length === 1 ? name : agent.slug;
    const collected = await collectAgentFiles({
      agent,
      blockName: name,
      targetSlug: prefix,
    });
    if (!collected.ok) return collected;
    planned.push(...collected.data.files);
    findings.push(...collected.data.findings);
  }

  planned.push(blockReadme({ name, agents, single: agents.length === 1 }));
  const filesToWrite = dedupePlanned(planned);

  if (findings.length > 0) {
    return {
      ok: false,
      error: {
        kind: "credentials",
        message:
          "Refusing to export. The source still looks like it contains credentials after sanitizing.",
        findings: unique(findings),
      },
    };
  }

  const files: RegistryFile[] = filesToWrite.map((file) => ({
    path: file.relativePath,
    type: "registry:file",
    target: file.target,
  }));

  const item = buildRegistryItem({
    name,
    agents,
    files,
  });

  const report: ExportReport = {
    name,
    type: "registry:block",
    dryRun: args.dryRun,
    files,
    agents: agents.map((agent) => agent.slug),
  };

  if (args.dryRun) {
    return { ok: true, data: report };
  }

  try {
    await writeExport({
      out,
      name,
      planned: filesToWrite,
      item,
      catalog: existingCatalog,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "io",
        message: error instanceof Error ? error.message : "Failed to write export",
      },
    };
  }

  return { ok: true, data: report };
}

async function inspectSource(from: string): Promise<Result<true>> {
  try {
    await access(from);
  } catch {
    return {
      ok: false,
      error: { kind: "io", message: `Source path does not exist: ${from}` },
    };
  }

  const findings: string[] = [];
  const entries = await readdir(from, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath, entry.name);
    const relative = path.relative(from, fullPath);
    const segments = relative.split(path.sep);
    if (segments.some((segment) => CREDENTIAL_DIRS.has(segment))) {
      findings.push(posixJoin(relative));
      continue;
    }
    if (entry.isFile() && isCredentialStore(entry.name)) {
      findings.push(posixJoin(relative));
    }
  }

  if (findings.length > 0) {
    return {
      ok: false,
      error: {
        kind: "credentials",
        message:
          "Refusing to export. The source looks like it contains credentials.",
        findings: unique(findings),
      },
    };
  }

  return { ok: true, data: true };
}

async function discoverAgents(from: string): Promise<AgentSource[]> {
  if (await isAgentDir(from)) {
    const profile = await readProfile(from);
    return [
      {
        slug: slugFromProfile(profile, path.basename(from)),
        root: from,
        title: stringField(profile, "title") ?? stringField(profile, "name") ?? "Agent",
        description:
          stringField(profile, "description") ??
          "Sanitized Grok Bot agent block.",
      },
    ];
  }

  const candidates = await agentCandidateDirs(from);
  const agents: AgentSource[] = [];
  const used = new Set<string>();
  for (const dir of candidates) {
    const profile = await readProfile(dir);
    const slug = uniqueSlug(slugFromProfile(profile, path.basename(dir)), used);
    used.add(slug);
    agents.push({
      slug,
      root: dir,
      title: stringField(profile, "title") ?? stringField(profile, "name") ?? slug,
      description:
        stringField(profile, "description") ?? "Sanitized Grok Bot agent block.",
    });
  }
  return agents.sort((left, right) => left.slug.localeCompare(right.slug));
}

async function agentCandidateDirs(from: string): Promise<string[]> {
  const found: string[] = [];
  const children = await readdir(from, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) continue;
    if (SKIP_DIRS.has(child.name) || CREDENTIAL_DIRS.has(child.name)) continue;
    const full = path.join(from, child.name);
    if (await isAgentDir(full)) {
      found.push(full);
      continue;
    }
    if (child.name === "agents") {
      const nested = await readdir(full, { withFileTypes: true });
      for (const inner of nested) {
        if (!inner.isDirectory()) continue;
        const innerFull = path.join(full, inner.name);
        if (await isAgentDir(innerFull)) found.push(innerFull);
      }
    }
  }
  return found;
}

async function isAgentDir(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, "profile.json"));
    return true;
  } catch {
    return false;
  }
}

async function collectAgentFiles(input: {
  agent: AgentSource;
  blockName: string;
  targetSlug: string;
}): Promise<Result<{ files: PlannedFile[]; findings: string[] }>> {
  const files: PlannedFile[] = [];
  const findings: string[] = [];
  const entries = await readdir(input.agent.root, {
    withFileTypes: true,
    recursive: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(entry.parentPath, entry.name);
    const relative = path.relative(input.agent.root, fullPath);
    const segments = relative.split(path.sep);
    if (segments.some((segment) => SKIP_DIRS.has(segment) || CREDENTIAL_DIRS.has(segment))) {
      continue;
    }
    if (isCredentialStore(entry.name) || shouldSkipFile(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const isText = TEXT_EXTENSIONS.has(ext);
    const isAvatar = BINARY_AVATAR_EXTENSIONS.has(ext);
    if (!isText && !isAvatar) continue;

    const raw = await readFile(fullPath);
    let contents = raw;
    if (isText) {
      const prepared = prepareTextFile(entry.name, raw.toString("utf8"));
      if (prepared.skip) continue;
      contents = Buffer.from(prepared.text, "utf8");
      if (prepared.findings.length > 0) {
        findings.push(
          `${posixJoin(relative)} (${prepared.findings.join(", ")})`,
        );
      }
    }

    files.push({
      relativePath: posixJoin("registry", input.blockName, input.targetSlug === input.blockName
        ? relative
        : path.join(input.targetSlug, relative)),
      target: `~/oficina/bots/${input.targetSlug}/${posixJoin(relative)}`,
      contents,
    });
  }

  return { ok: true, data: { files, findings } };
}

function prepareTextFile(
  fileName: string,
  text: string,
): { text: string; skip: boolean; findings: string[] } {
  if (fileName === "profile.json") {
    try {
      const parsed: unknown = JSON.parse(text);
      const profile = pickProfile(parsed);
      const rendered = `${JSON.stringify(profile, null, 2)}\n`;
      return leftoverResult(rendered, false);
    } catch {
      return leftoverResult(sanitizeText(text), false);
    }
  }

  if (path.extname(fileName).toLowerCase() === ".json") {
    try {
      const parsed: unknown = JSON.parse(text);
      const sanitized = sanitizeJson(parsed);
      if (isEmptyObject(sanitized)) {
        return { text: "", skip: true, findings: [] };
      }
      return leftoverResult(`${JSON.stringify(sanitized, null, 2)}\n`, false);
    } catch {
      return leftoverResult(sanitizeText(text), false);
    }
  }

  return leftoverResult(sanitizeText(text), false);
}

function leftoverResult(
  text: string,
  skip: boolean,
): { text: string; skip: boolean; findings: string[] } {
  return {
    text,
    skip,
    findings: looksLikeSecret(text) ? findSecretHits(text) : [],
  };
}

function pickProfile(value: unknown): Record<string, string> {
  const record = isRecord(value) ? value : {};
  const profile: Record<string, string> = {};
  for (const key of ["name", "title", "description", "avatar"] as const) {
    const field = stringField(record, key);
    if (field != null) profile[key] = field;
  }
  return profile;
}

function blockReadme(input: {
  name: string;
  agents: AgentSource[];
  single: boolean;
}): PlannedFile {
  const agentLines = input.agents
    .map((agent) => `- \`${agent.slug}\` — ${agent.title}`)
    .join("\n");
  const writeRoot = input.single
    ? `oficina/bots/${input.name}/`
    : "oficina/bots/<agent-slug>/";
  const contents = [
    `# ${titleFromSlug(input.name)}`,
    "",
    "Sanitized Grok Bot factory block. One official shadcn add installs every safe file.",
    "",
    "```bash",
    `npx shadcn@latest add <owner>/<repo>/${input.name}`,
    "```",
    "",
    "If you already host built item JSON, the same snapshot works as:",
    "",
    "```bash",
    `npx shadcn@latest add https://<host>/r/${input.name}.json`,
    "```",
    "",
    "Run the command from the directory where you want the files. In shadcn `files[].target`, `~/` is that cwd, not `$HOME`.",
    "",
    `Files land at \`${writeRoot}\` under that directory.`,
    "",
    "## Agents",
    "",
    agentLines,
    "",
    "This block does not include secrets, tokens, memory, transcripts, or live databases.",
    "",
  ].join("\n");

  return {
    relativePath: posixJoin("registry", input.name, "README.md"),
    target: input.single
      ? `~/oficina/bots/${input.name}/README.md`
      : `~/oficina/bots/${input.name}/README.md`,
    contents: Buffer.from(contents, "utf8"),
  };
}

function buildRegistryItem(input: {
  name: string;
  agents: AgentSource[];
  files: RegistryFile[];
}): Record<string, unknown> {
  const single = input.agents.length === 1;
  const title = single ? input.agents[0]?.title ?? titleFromSlug(input.name) : titleFromSlug(input.name);
  const description = single
    ? input.agents[0]?.description ?? "Sanitized Grok Bot factory block."
    : `Sanitized Grok Bot factory block with ${input.agents.length} agents.`;

  return {
    name: input.name,
    type: "registry:block",
    title,
    description,
    categories: ["grok-bot", "template", "block"],
    meta: {
      kind: "grok-bot-factory-block",
      source: single ? "agent" : "factory",
      agents: input.agents.map((agent) => agent.slug),
    },
    docs: "Install with the official shadcn CLI. Run add from the directory that should receive oficina/bots/. ~/ in files[].target is project cwd, not $HOME. This block never includes secrets, memory, transcripts, or live databases.",
    files: input.files,
  };
}

async function writeExport(input: {
  out: string;
  name: string;
  planned: PlannedFile[];
  item: Record<string, unknown>;
  catalog: Record<string, unknown>;
}): Promise<void> {
  const itemDir = path.join(input.out, "registry", input.name);
  await rm(itemDir, { recursive: true, force: true });
  for (const file of input.planned) {
    const dest = path.join(input.out, file.relativePath);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.contents);
  }

  const catalogPath = path.join(input.out, "registry.json");
  const items = Array.isArray(input.catalog.items) ? input.catalog.items : [];
  const nextItems = items.filter((item) => {
    return !(isRecord(item) && item.name === input.name);
  });
  nextItems.push(input.item);
  const catalog = {
    ...input.catalog,
    items: nextItems,
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

async function readCatalog(
  catalogPath: string,
  fallbackName: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
    if (isRecord(parsed)) return parsed;
  } catch {
    // Create a minimal catalog when the destination is a fresh repo.
  }
  return {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: fallbackName,
    homepage: "https://github.com/owner/repo",
    items: [],
  };
}

function catalogHasItem(catalog: Record<string, unknown>, name: string): boolean {
  if (!Array.isArray(catalog.items)) return false;
  return catalog.items.some((item) => isRecord(item) && item.name === name);
}

async function readProfile(dir: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(dir, "profile.json"), "utf8"),
    );
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function slugFromProfile(
  profile: Record<string, unknown>,
  fallbackName: string,
): string {
  const fromProfile = stringField(profile, "name");
  if (fromProfile) {
    const slug = slugify(fromProfile);
    if (slug.length > 0) return slug;
  }
  if (!UUID_PATTERN.test(fallbackName)) {
    const slug = slugify(fallbackName);
    if (slug.length > 0) return slug;
  }
  return "agent";
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isCredentialStore(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (CREDENTIAL_FILES.has(lower)) return true;
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  const ext = path.extname(lower);
  return ext === ".pem" || ext === ".key";
}

function shouldSkipFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower === ".ds_store" || lower === "thumbs.db" || lower.endsWith(".log");
}

function posixJoin(...parts: string[]): string {
  return path.posix.join(...parts.map((part) => part.split(path.sep).join("/")));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupePlanned(files: PlannedFile[]): PlannedFile[] {
  const map = new Map<string, PlannedFile>();
  for (const file of files) {
    map.set(file.relativePath, file);
  }
  return [...map.values()];
}

function isEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
