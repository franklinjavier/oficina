const SECRET_KEYS = new Set([
  "accesstoken",
  "accesskey",
  "accesskeyid",
  "apikey",
  "apisecret",
  "authorization",
  "auth",
  "bearer",
  "clientsecret",
  "connectortoken",
  "cookie",
  "credential",
  "credentials",
  "email",
  "emailaddress",
  "passwd",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
  "webhook",
  "webhookkey",
  "webhookurl",
]);

const EXACT_ONLY_KEYS = new Set(["auth"]);

const TOKEN_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /xai-[A-Za-z0-9_-]{16,}/g,
  /AIza[A-Za-z0-9_-]{30,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /\b[0-9]{3,}:AA[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /https?:\/\/hooks\.[^\s"'\\]+/gi,
  /https?:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'\\]+/gi,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SLACK_CHANNEL_PATTERN = /\b[CDG](?=[A-Z0-9]*[0-9])[A-Z0-9]{8,}\b/g;
const ASSIGNMENT_LINE =
  /(?:^|[\s"'`])([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*\S+/gm;

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SECRET_KEYS.has(normalized)) return true;

  const parts = splitKeyParts(key);
  for (let take = 1; take <= Math.min(3, parts.length); take += 1) {
    if (parts.length === 1 && take === 1) continue;
    const suffix = normalizeKey(parts.slice(-take).join(""));
    if (SECRET_KEYS.has(suffix) && !EXACT_ONLY_KEYS.has(suffix)) return true;
  }

  for (const secret of SECRET_KEYS) {
    if (EXACT_ONLY_KEYS.has(secret)) continue;
    if (normalized.length > secret.length && normalized.endsWith(secret)) {
      return true;
    }
  }
  return false;
}

export function looksLikeSecret(value: string): boolean {
  return findSecretHits(value).length > 0;
}

export function sanitizeText(value: string): string {
  let next = value;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, "[redacted]");
    pattern.lastIndex = 0;
  }
  next = next.replace(EMAIL_PATTERN, "[redacted]");
  next = next.replace(SLACK_CHANNEL_PATTERN, "[redacted]");
  return next;
}

export function sanitizeJson(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJson(entry));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (isSecretKey(key)) continue;
    next[key] = sanitizeJson(entry);
  }
  return next;
}

export function findSecretHits(text: string): string[] {
  const hits: string[] = [];
  if (testAndReset(EMAIL_PATTERN, text)) hits.push("email");
  if (testAndReset(SLACK_CHANNEL_PATTERN, text)) hits.push("channel-id");
  if (hasSecretAssignment(text)) hits.push("assignment");
  for (const pattern of TOKEN_PATTERNS) {
    if (testAndReset(pattern, text)) {
      hits.push("token");
      break;
    }
  }
  return hits;
}

function hasSecretAssignment(text: string): boolean {
  ASSIGNMENT_LINE.lastIndex = 0;
  let match = ASSIGNMENT_LINE.exec(text);
  while (match != null) {
    const key = match[1];
    if (key != null && isSecretKey(key)) {
      ASSIGNMENT_LINE.lastIndex = 0;
      return true;
    }
    match = ASSIGNMENT_LINE.exec(text);
  }
  ASSIGNMENT_LINE.lastIndex = 0;
  return false;
}

function splitKeyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1\0$2")
    .split(/[\0_-]+/)
    .filter((part) => part.length > 0);
}

function testAndReset(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}
