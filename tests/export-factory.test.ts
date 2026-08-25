import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { exportFactory, parseArgs } from "../scripts/lib/export-factory.ts";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_TOKEN = "sk-test_abcdefghijklmnopqrstuvwxyz123456";
const FAKE_WEBHOOK =
  "https://hooks.example.test/services/T000/B000/abcdefghijklmnopqrstuvwx";
const FAKE_EMAIL = "crewmate@example.test";
const BANNED_NAMES = ["Frank" + "lin", "frank" + "lin", "Da" + "20", "da" + "20"];

async function makeOutDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "oficina-export-"));
  await writeFile(
    path.join(dir, "registry.json"),
    `${JSON.stringify(
      {
        $schema: "https://ui.shadcn.com/schema/registry.json",
        name: "crew-templates",
        homepage: "https://github.com/example/crew-templates",
        items: [
          {
            name: "orchestrator",
            type: "registry:item",
            title: "Orchestrator",
            files: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function readUtf8Tree(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(entry.parentPath, entry.name);
    chunks.push(await readFile(fullPath, "utf8"));
  }
  return chunks.join("\n");
}

test("parseArgs requires --from and --name", () => {
  const missingFrom = parseArgs(["--name", "crew"]);
  assert.equal(missingFrom.ok, false);
  if (!missingFrom.ok) {
    assert.equal(missingFrom.error.kind, "usage");
  }

  const missingName = parseArgs(["--from", "/tmp/agent"]);
  assert.equal(missingName.ok, false);
  if (!missingName.ok) {
    assert.equal(missingName.error.kind, "usage");
  }
});

test("exports a single agent as a registry:block", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-agent-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes for an invented newsroom desk.",
    avatar: "avatar.svg",
  });
  await writeText(
    path.join(source, "avatar.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n`,
  );
  await writeJson(path.join(source, "settings.json"), {
    theme: "dark",
    locale: "en",
    apiKey: FAKE_TOKEN,
  });
  await writeText(
    path.join(source, "skills", "sort-mail.md"),
    "# Sort mail\n\nGeneric invented skill. Group incoming notes by desk.\n",
  );
  await writeJson(path.join(source, "automations", "dawn-sort", "automation.json"), {
    name: "dawn-sort",
    enabled: true,
    schedule: { kind: "cron", expr: "0 7 * * 1-5", timezone: "UTC" },
    skill: "sort-mail",
    webhook: FAKE_WEBHOOK,
    notify: FAKE_EMAIL,
    instructions: "Sort overnight notes. Do not send external messages.",
  });
  await writeText(path.join(source, "memory", "private-notes.md"), "do not copy\n");
  await writeText(path.join(source, "transcripts", "chat.jsonl"), "{}\n");

  const result = await exportFactory({
    from: source,
    name: "quill",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.type, "registry:block");
  assert.equal(result.data.name, "quill");

  const profile = JSON.parse(
    await readFile(path.join(out, "registry", "quill", "profile.json"), "utf8"),
  ) as { name: string };
  assert.equal(profile.name, "Quill");

  const settings = JSON.parse(
    await readFile(path.join(out, "registry", "quill", "settings.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  assert.equal(settings.locale, "en");
  assert.equal(settings.apiKey, undefined);

  const skill = await readFile(
    path.join(out, "registry", "quill", "skills", "sort-mail.md"),
    "utf8",
  );
  assert.match(skill, /Sort mail/);

  const automation = JSON.parse(
    await readFile(
      path.join(out, "registry", "quill", "automations", "dawn-sort", "automation.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(automation.webhook, undefined);
  assert.equal(automation.notify, "[redacted]");
  assert.equal(automation.skill, "sort-mail");

  await assert.rejects(
    readFile(path.join(out, "registry", "quill", "memory", "private-notes.md")),
  );
  await assert.rejects(
    readFile(path.join(out, "registry", "quill", "transcripts", "chat.jsonl")),
  );

  const catalog = JSON.parse(await readFile(path.join(out, "registry.json"), "utf8")) as {
    items: Array<{ name: string; type: string; files: Array<{ path: string; type: string; target: string }> }>;
  };
  const names = catalog.items.map((item) => item.name);
  assert.deepEqual(names, ["orchestrator", "quill"]);
  const block = catalog.items.find((item) => item.name === "quill");
  assert.ok(block);
  assert.equal(block.type, "registry:block");
  assert.ok(block.files.every((file) => file.type === "registry:file"));
  assert.ok(
    block.files.some(
      (file) => file.target === "~/oficina/bots/quill/profile.json",
    ),
  );

  const written = await readUtf8Tree(path.join(out, "registry", "quill"));
  assert.doesNotMatch(written, new RegExp(FAKE_TOKEN));
  assert.doesNotMatch(written, new RegExp(FAKE_WEBHOOK));
  assert.doesNotMatch(written, new RegExp(FAKE_EMAIL));

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("exports a factory parent as one named block", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-factory-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "agents", "alpha-id", "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(
    path.join(source, "agents", "alpha-id", "skills", "sort-mail.md"),
    "# Sort mail\n\nGeneric invented skill.\n",
  );
  await writeJson(path.join(source, "agents", "beta-id", "profile.json"), {
    name: "Atlas",
    title: "Chart Watcher",
    description: "Tracks invented fleet charts.",
  });
  await writeJson(
    path.join(source, "agents", "beta-id", "routines", "weekly-review.template.json"),
    {
      name: "weekly-review",
      enabled: false,
      skill: "crew-status",
      instructions: "Draft a weekly review from published briefs only.",
    },
  );

  const result = await exportFactory({
    from: source,
    name: "newsroom",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.type, "registry:block");
  const catalog = JSON.parse(await readFile(path.join(out, "registry.json"), "utf8")) as {
    items: Array<{ name: string; files: Array<{ target: string }> }>;
  };
  const block = catalog.items.find((item) => item.name === "newsroom");
  assert.ok(block);
  const targets = block.files.map((file) => file.target);
  assert.ok(targets.includes("~/oficina/bots/quill/profile.json"));
  assert.ok(targets.includes("~/oficina/bots/atlas/profile.json"));
  assert.ok(
    targets.includes("~/oficina/bots/atlas/routines/weekly-review.template.json"),
  );

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("strips token-looking strings from exported files", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-tokens-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Helm",
    title: "Watch Desk",
    description: "Fictional watch desk. No live credentials.",
  });
  await writeJson(path.join(source, "automations", "ping", "automation.json"), {
    name: "ping",
    token: FAKE_TOKEN,
    instructions: `Call ${FAKE_WEBHOOK} and mail ${FAKE_EMAIL}`,
    channel_id: "C0123456789",
  });

  const result = await exportFactory({
    from: source,
    name: "watch-desk",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const written = await readUtf8Tree(path.join(out, "registry", "watch-desk"));
  assert.doesNotMatch(written, new RegExp(FAKE_TOKEN));
  assert.doesNotMatch(written, new RegExp(FAKE_WEBHOOK));
  assert.doesNotMatch(written, new RegExp(FAKE_EMAIL));
  assert.doesNotMatch(written, /C0123456789/);

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses when the source has credential stores", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-creds-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(path.join(source, "factory.db"), "not-a-real-db");

  const result = await exportFactory({
    from: source,
    name: "dirty-factory",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "credentials");

  await assert.rejects(readdir(path.join(out, "registry", "dirty-factory")));

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses when a leftover token remains after stripping", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-leftover-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: `Public bio that accidentally embeds ${FAKE_TOKEN}`,
  });

  const result = await exportFactory({
    from: source,
    name: "leaky-profile",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "credentials");
  if (result.error.kind === "credentials") {
    assert.doesNotMatch(result.error.message, new RegExp(FAKE_TOKEN));
  }

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("dry-run reports the block and writes nothing", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-dry-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });

  const result = await exportFactory({
    from: source,
    name: "quill",
    out,
    dryRun: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.dryRun, true);
  assert.equal(result.data.type, "registry:block");
  await assert.rejects(readdir(path.join(out, "registry", "quill")));

  const catalog = JSON.parse(await readFile(path.join(out, "registry.json"), "utf8")) as {
    items: Array<{ name: string }>;
  };
  assert.deepEqual(
    catalog.items.map((item) => item.name),
    ["orchestrator"],
  );

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses to overwrite the fictional orchestrator item", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-reserved-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });

  const result = await exportFactory({
    from: source,
    name: "orchestrator",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "reserved");

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("writes a standalone catalog that is not this tool repo", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-fresh-"));
  const out = await mkdtemp(path.join(tmpdir(), "oficina-fresh-out-"));

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });

  const result = await exportFactory({
    from: source,
    name: "quill",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const catalogRaw = await readFile(path.join(out, "registry.json"), "utf8");
  assert.doesNotMatch(catalogRaw, /franklinjavier/);
  assert.doesNotMatch(catalogRaw, /oficina\/orchestrator/);
  const catalog = JSON.parse(catalogRaw) as {
    name: string;
    homepage: string;
    items: Array<{ name: string; files: Array<{ target: string }> }>;
  };
  assert.equal(catalog.name, "quill");
  assert.equal(catalog.homepage, "https://github.com/owner/repo");
  assert.deepEqual(
    catalog.items.map((item) => item.name),
    ["quill"],
  );

  const readme = await readFile(path.join(out, "registry", "quill", "README.md"), "utf8");
  assert.match(readme, /npx shadcn@latest add <owner>\/<repo>\/quill/);
  assert.doesNotMatch(readme, /pull request/i);
  assert.doesNotMatch(readme, /franklinjavier\/oficina\/quill/);
  assert.match(readme, /oficina\/bots\/quill\//);

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("fixtures, exporter, and tests omit banned real names", async () => {
  const tree = await readUtf8Tree(path.join(repoRoot, "scripts"));
  const tests = await readUtf8Tree(path.join(repoRoot, "tests"));
  const combined = `${tree}\n${tests}`;
  for (const name of BANNED_NAMES) {
    assert.doesNotMatch(combined, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(tree, /franklinjavier/);
});
