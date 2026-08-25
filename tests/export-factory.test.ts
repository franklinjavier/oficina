import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { exportFactory, parseArgs } from "../scripts/lib/export-factory.ts";
import { isSecretKey, looksLikeSecret } from "../scripts/lib/secrets.ts";

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

test("parseArgs requires --from, --name, and --out", () => {
  const missingFrom = parseArgs(["--name", "crew", "--out", "/tmp/templates"]);
  assert.equal(missingFrom.ok, false);
  if (!missingFrom.ok) {
    assert.equal(missingFrom.error.kind, "usage");
  }

  const missingName = parseArgs(["--from", "/tmp/agent", "--out", "/tmp/templates"]);
  assert.equal(missingName.ok, false);
  if (!missingName.ok) {
    assert.equal(missingName.error.kind, "usage");
  }

  const missingOut = parseArgs(["--from", "/tmp/agent", "--name", "crew"]);
  assert.equal(missingOut.ok, false);
  if (!missingOut.ok) {
    assert.equal(missingOut.error.kind, "usage");
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

test("refuses OpenSSH key names and .ssh directories", async () => {
  const cases = [
    { name: "id_ed25519", write: async (root: string) => writeText(path.join(root, "id_ed25519"), "ssh-key") },
    { name: "id_ecdsa", write: async (root: string) => writeText(path.join(root, "id_ecdsa"), "ssh-key") },
    {
      name: ".ssh",
      write: async (root: string) => writeText(path.join(root, ".ssh", "config"), "Host *\n"),
    },
  ] as const;

  for (const item of cases) {
    const source = await mkdtemp(path.join(tmpdir(), "oficina-ssh-"));
    const out = await makeOutDir();
    await writeJson(path.join(source, "profile.json"), {
      name: "Quill",
      title: "Inbox Clerk",
      description: "Owns intake notes.",
    });
    await item.write(source);

    const result = await exportFactory({
      from: source,
      name: "ssh-leak",
      out,
      dryRun: false,
    });
    assert.equal(result.ok, false, item.name);
    if (!result.ok) {
      assert.equal(result.error.kind, "credentials");
    }
    await assert.rejects(readdir(path.join(out, "registry", "ssh-leak")));

    await rm(source, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("refuses --out when it is this tool repo", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-tool-out-"));
  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });

  const outs = [
    repoRoot,
    path.join(repoRoot, "public"),
    path.join(repoRoot, "registry"),
    path.join(repoRoot, "scripts", "lib"),
  ];
  for (const out of outs) {
    const result = await exportFactory({
      from: source,
      name: "quill",
      out,
      dryRun: true,
    });
    assert.equal(result.ok, false, out);
    if (!result.ok) {
      assert.equal(result.error.kind, "usage");
      assert.match(result.error.message, /export-factory\.ts/);
    }
  }

  await rm(source, { recursive: true, force: true });
});

test("drops or refuses camelCase and underscored secret keys", async () => {
  assert.equal(isSecretKey("botToken"), true);
  assert.equal(isSecretKey("db_password"), true);
  assert.equal(isSecretKey("TELEGRAM_BOT_TOKEN"), true);
  assert.equal(isSecretKey("AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(isSecretKey("secretKey"), true);
  assert.equal(isSecretKey("SECRET_KEY"), true);
  assert.equal(isSecretKey("SECRET_KEY_BASE"), true);
  assert.equal(isSecretKey("STRIPE_SECRET_KEY"), true);
  assert.equal(isSecretKey("API_SECRET_KEY"), true);
  assert.equal(isSecretKey("my_secret_key"), true);
  assert.equal(isSecretKey("passphrase"), true);
  assert.equal(isSecretKey("db_passphrase"), true);
  assert.equal(isSecretKey("ENCRYPTION_KEY"), true);
  assert.equal(isSecretKey("OPENAI_KEY"), true);
  assert.equal(isSecretKey("SIGNING_KEY"), true);
  assert.equal(isSecretKey("MASTER_KEY"), true);
  assert.equal(isSecretKey("key"), true);
  assert.equal(isSecretKey("author"), false);
  assert.equal(isSecretKey("locale"), false);
  assert.equal(isSecretKey("turkey"), false);
  assert.equal(isSecretKey("monkey"), false);
  assert.equal(
    looksLikeSecret("123:AAHabcdefghijklmnopqrstuvwxyz"),
    true,
  );

  const source = await mkdtemp(path.join(tmpdir(), "oficina-camel-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeJson(path.join(source, "settings.json"), {
    theme: "dark",
    botToken: "hunter2",
    db_password: "hunter2",
    secretKey: "hunter2",
    SECRET_KEY: "hunter2",
    SECRET_KEY_BASE: "hunter2",
    STRIPE_SECRET_KEY: "hunter2",
    API_SECRET_KEY: "hunter2",
    my_secret_key: "hunter2",
    ENCRYPTION_KEY: "hunter2",
    OPENAI_KEY: "hunter2",
    SIGNING_KEY: "hunter2",
    MASTER_KEY: "hunter2",
    passphrase: "hunter2",
    turkey: "keep-turkey",
    monkey: "keep-monkey",
  });

  const dropped = await exportFactory({
    from: source,
    name: "camel-drop",
    out,
    dryRun: false,
  });

  assert.equal(dropped.ok, true);
  if (!dropped.ok) return;
  const settings = JSON.parse(
    await readFile(path.join(out, "registry", "camel-drop", "settings.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  assert.equal(settings.botToken, undefined);
  assert.equal(settings.db_password, undefined);
  assert.equal(settings.secretKey, undefined);
  assert.equal(settings.SECRET_KEY, undefined);
  assert.equal(settings.SECRET_KEY_BASE, undefined);
  assert.equal(settings.STRIPE_SECRET_KEY, undefined);
  assert.equal(settings.API_SECRET_KEY, undefined);
  assert.equal(settings.my_secret_key, undefined);
  assert.equal(settings.ENCRYPTION_KEY, undefined);
  assert.equal(settings.OPENAI_KEY, undefined);
  assert.equal(settings.SIGNING_KEY, undefined);
  assert.equal(settings.MASTER_KEY, undefined);
  assert.equal(settings.passphrase, undefined);
  assert.equal(settings.turkey, "keep-turkey");
  assert.equal(settings.monkey, "keep-monkey");
  const written = await readUtf8Tree(path.join(out, "registry", "camel-drop"));
  assert.doesNotMatch(written, /hunter2/);
  assert.match(written, /keep-turkey/);
  assert.match(written, /keep-monkey/);

  await writeText(
    path.join(source, "skills", "secrets.md"),
    ["# Notes", "", "botToken: leftover", "db_password: leftover", ""].join("\n"),
  );

  const refused = await exportFactory({
    from: source,
    name: "camel-refuse",
    out,
    dryRun: false,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.error.kind, "credentials");
  }
  await assert.rejects(readdir(path.join(out, "registry", "camel-refuse")));

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

function stripeLikeKey(prefix: "sk" | "rk", mode: "live" | "test"): string {
  return [prefix, mode, "abcdefghijklmnopqrstuvwx"].join("_");
}

test("redacts Stripe keys and credential URIs when the key is not dropped", async () => {
  const stripeLive = stripeLikeKey("sk", "live");
  const stripeTest = stripeLikeKey("sk", "test");
  const stripeRestricted = stripeLikeKey("rk", "live");
  const postgresUri = "postgres://desk:hunter2@db.example.test:5432/newsroom";
  const mysqlUri = "mysql://desk:hunter2@db.example.test:3306/newsroom";
  const mongoUri = "mongodb://desk:hunter2@db.example.test:27017/newsroom";
  const mongoSrv = "mongodb+srv://desk:hunter2@db.example.test/newsroom";
  const redisUri = "redis://desk:hunter2@cache.example.test:6379/0";
  const redissUri = "rediss://desk:hunter2@cache.example.test:6380/0";
  const amqpUri = "amqp://desk:hunter2@queue.example.test:5672/newsroom";
  const amqpsUri = "amqps://desk:hunter2@queue.example.test:5671/newsroom";
  const proxyUri = "https://desk:hunter2@proxy.example.test:8443";
  const httpProxyUri = "http://desk:hunter2@proxy.example.test:8080";
  const schemelessUri = "desk:hunter2@db.example.test:5432/newsroom";

  assert.equal(looksLikeSecret(stripeLive), true);
  assert.equal(looksLikeSecret(postgresUri), true);
  assert.equal(looksLikeSecret(redisUri), true);
  assert.equal(looksLikeSecret(redissUri), true);
  assert.equal(looksLikeSecret(amqpUri), true);
  assert.equal(looksLikeSecret(amqpsUri), true);
  assert.equal(looksLikeSecret(proxyUri), true);
  assert.equal(looksLikeSecret(httpProxyUri), true);
  assert.equal(looksLikeSecret(schemelessUri), true);
  assert.equal(isSecretKey("databaseUrl"), false);
  assert.equal(isSecretKey("DATABASE_URL"), false);
  assert.equal(isSecretKey("connectionString"), false);
  assert.equal(isSecretKey("redisUrl"), false);
  assert.equal(isSecretKey("proxyUrl"), false);

  const source = await mkdtemp(path.join(tmpdir(), "oficina-uris-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: `Owns intake notes. Never embed ${stripeLive} or ${postgresUri}.`,
  });

  const leakyProfile = await exportFactory({
    from: source,
    name: "uri-profile",
    out,
    dryRun: false,
  });
  assert.equal(leakyProfile.ok, false);
  if (!leakyProfile.ok) {
    assert.equal(leakyProfile.error.kind, "credentials");
    assert.doesNotMatch(leakyProfile.error.message, new RegExp(stripeLive));
    assert.doesNotMatch(leakyProfile.error.message, /postgres:\/\//);
  }

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeJson(path.join(source, "settings.json"), {
    theme: "dark",
    databaseUrl: postgresUri,
    DATABASE_URL: mysqlUri,
    connectionString: mongoUri,
    redisUrl: redisUri,
    cacheUrl: redissUri,
    queueUrl: amqpUri,
    brokerUrl: amqpsUri,
    proxyUrl: proxyUri,
    httpProxy: httpProxyUri,
    backupUrl: schemelessUri,
    note: `${stripeTest} ${stripeRestricted} ${mongoSrv}`,
  });

  const result = await exportFactory({
    from: source,
    name: "uri-settings",
    out,
    dryRun: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const settings = JSON.parse(
    await readFile(path.join(out, "registry", "uri-settings", "settings.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  const written = await readUtf8Tree(path.join(out, "registry", "uri-settings"));
  assert.doesNotMatch(written, new RegExp(stripeLive));
  assert.doesNotMatch(written, new RegExp(stripeTest));
  assert.doesNotMatch(written, new RegExp(stripeRestricted));
  assert.doesNotMatch(written, /postgres:\/\//);
  assert.doesNotMatch(written, /mysql:\/\//);
  assert.doesNotMatch(written, /mongodb:\/\//);
  assert.doesNotMatch(written, /mongodb\+srv:\/\//);
  assert.doesNotMatch(written, /rediss?:\/\//);
  assert.doesNotMatch(written, /amqps?:\/\//);
  assert.doesNotMatch(written, /https:\/\/desk:/);
  assert.doesNotMatch(written, /http:\/\/desk:/);
  assert.doesNotMatch(written, /desk:hunter2@/);
  assert.doesNotMatch(written, /hunter2/);

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses dotted and multiline leftover assignments", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-dotted-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(
    path.join(source, "skills", "env-notes.md"),
    [
      "# Env notes",
      "",
      "process.env.API_KEY=hunter2",
      "obj.password = hunter2",
      "",
    ].join("\n"),
  );
  await writeText(
    path.join(source, "settings.yaml"),
    ["locale: en", "password:", "  hunter2", ""].join("\n"),
  );

  const result = await exportFactory({
    from: source,
    name: "dotted-assign",
    out,
    dryRun: false,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "credentials");
  if (result.error.kind === "credentials") {
    assert.ok(result.error.findings.some((finding) => finding.includes("env-notes.md")));
    assert.ok(result.error.findings.some((finding) => finding.includes("settings.yaml")));
    assert.doesNotMatch(result.error.findings.join("\n"), /hunter2/);
  }
  await assert.rejects(readdir(path.join(out, "registry", "dotted-assign")));

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses quoted, bracket, delimiter, and trailing-comma leftover assignments", async () => {
  assert.equal(looksLikeSecret('"password": hunter2'), true);
  assert.equal(looksLikeSecret("'apiKey': leftover"), true);
  assert.equal(looksLikeSecret('process.env["API_KEY"]=hunter2'), true);
  assert.equal(looksLikeSecret("obj['password'] = hunter2"), true);
  assert.equal(looksLikeSecret("Server=tcp:db.example.test;Password=hunter2"), true);
  assert.equal(looksLikeSecret("?api_key=hunter2"), true);
  assert.equal(looksLikeSecret("&token=hunter2"), true);
  assert.equal(looksLikeSecret("key=hunter2"), true);
  assert.equal(looksLikeSecret("passphrase=hunter2"), true);
  assert.equal(looksLikeSecret("turkey=ok"), false);
  assert.equal(looksLikeSecret("monkey=ok"), false);

  const source = await mkdtemp(path.join(tmpdir(), "oficina-assign-class-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(
    path.join(source, "skills", "quoted-notes.md"),
    ['# Notes', "", '"password": hunter2', "'apiKey': leftover", ""].join("\n"),
  );
  await writeText(
    path.join(source, "skills", "bracket-notes.md"),
    [
      "# Notes",
      "",
      'process.env["API_KEY"]=hunter2',
      "obj['password'] = hunter2",
      "",
    ].join("\n"),
  );
  await writeText(
    path.join(source, "skills", "delimited-notes.md"),
    [
      "# Notes",
      "",
      "Server=tcp:db.example.test;Password=hunter2",
      "https://example.test/hook?api_key=hunter2",
      "https://example.test/hook&token=hunter2",
      "key=hunter2",
      "passphrase=hunter2",
      "",
    ].join("\n"),
  );
  await writeText(
    path.join(source, "settings.json"),
    ['{', '  "theme": "dark",', '  "password": "hunter2",', "}", ""].join("\n"),
  );

  const result = await exportFactory({
    from: source,
    name: "assign-class",
    out,
    dryRun: false,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "credentials");
  if (result.error.kind === "credentials") {
    const findings = result.error.findings.join("\n");
    assert.ok(findings.includes("quoted-notes.md"));
    assert.ok(findings.includes("bracket-notes.md"));
    assert.ok(findings.includes("delimited-notes.md"));
    assert.ok(findings.includes("settings.json"));
    assert.doesNotMatch(findings, /hunter2/);
    assert.doesNotMatch(result.error.message, /hunter2/);
  }
  await assert.rejects(readdir(path.join(out, "registry", "assign-class")));

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("redacts GitHub, Slack app, and npm tokens under innocent keys", async () => {
  const githubTokens = (["o", "u", "s", "r"] as const).map((kind) =>
    ["gh", kind, "_", "abcdefghijklmnopqrstuv"].join(""),
  );
  const slackApp = ["xapp", "1", "A0123456789", "1234567890123", "abcdefabcdef"].join(
    "-",
  );
  const npmToken = ["npm", "abcdefghijklmnopqrstuvwx"].join("_");

  for (const token of githubTokens) {
    assert.equal(looksLikeSecret(token), true, token.slice(0, 4));
  }
  assert.equal(looksLikeSecret(slackApp), true);
  assert.equal(looksLikeSecret(npmToken), true);

  const source = await mkdtemp(path.join(tmpdir(), "oficina-extra-tokens-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeJson(path.join(source, "settings.json"), {
    theme: "dark",
    note: githubTokens.join(" "),
    comment: slackApp,
    hint: npmToken,
  });

  const result = await exportFactory({
    from: source,
    name: "extra-tokens",
    out,
    dryRun: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const settings = JSON.parse(
    await readFile(path.join(out, "registry", "extra-tokens", "settings.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  const written = await readUtf8Tree(path.join(out, "registry", "extra-tokens"));
  for (const token of githubTokens) {
    assert.doesNotMatch(written, new RegExp(token));
  }
  assert.doesNotMatch(written, new RegExp(slackApp));
  assert.doesNotMatch(written, new RegExp(npmToken));
  assert.match(String(settings.note), /\[redacted\]/);
  assert.match(String(settings.comment), /\[redacted\]/);
  assert.match(String(settings.hint), /\[redacted\]/);

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("refuses leftover assignment-style secrets in markdown and yaml", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "oficina-assign-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(
    path.join(source, "skills", "local-notes.md"),
    ["# Local notes", "", "password: hunter2", ""].join("\n"),
  );
  await writeText(
    path.join(source, "settings.yaml"),
    ["locale: en", "SLACK_BOT_TOKEN=custom", ""].join("\n"),
  );

  const result = await exportFactory({
    from: source,
    name: "leaky-notes",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "credentials");
  if (result.error.kind === "credentials") {
    assert.ok(result.error.findings.some((finding) => finding.includes("local-notes.md")));
    assert.ok(result.error.findings.some((finding) => finding.includes("settings.yaml")));
    assert.doesNotMatch(result.error.message, /hunter2/);
    assert.doesNotMatch(result.error.findings.join("\n"), /hunter2/);
    assert.doesNotMatch(result.error.findings.join("\n"), /custom/);
  }
  await assert.rejects(readdir(path.join(out, "registry", "leaky-notes")));

  const dryRun = await exportFactory({
    from: source,
    name: "leaky-notes",
    out,
    dryRun: true,
  });
  assert.equal(dryRun.ok, false);
  if (!dryRun.ok) {
    assert.equal(dryRun.error.kind, "credentials");
  }

  await rm(source, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("does not treat CONFIGURE-style words as Slack channel ids", async () => {
  assert.equal(looksLikeSecret("CONFIGURE"), false);
  assert.equal(looksLikeSecret("DEBUGGING"), false);
  assert.equal(looksLikeSecret("DEPLOYMENT"), false);
  assert.equal(looksLikeSecret("C0123456789"), true);

  const source = await mkdtemp(path.join(tmpdir(), "oficina-caps-"));
  const out = await makeOutDir();

  await writeJson(path.join(source, "profile.json"), {
    name: "Quill",
    title: "Inbox Clerk",
    description: "Owns intake notes.",
  });
  await writeText(
    path.join(source, "skills", "desk.md"),
    "# Desk\n\nCONFIGURE the DEBUGGING path before DEPLOYMENT.\n",
  );

  const result = await exportFactory({
    from: source,
    name: "desk-words",
    out,
    dryRun: false,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const skill = await readFile(
    path.join(out, "registry", "desk-words", "skills", "desk.md"),
    "utf8",
  );
  assert.match(skill, /CONFIGURE/);
  assert.match(skill, /DEBUGGING/);
  assert.match(skill, /DEPLOYMENT/);

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
