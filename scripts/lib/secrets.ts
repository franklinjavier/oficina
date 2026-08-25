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

const TOKEN_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /xai-[A-Za-z0-9_-]{16,}/g,
  /AIza[A-Za-z0-9_-]{30,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /https?:\/\/hooks\.[^\s"'\\]+/gi,
  /https?:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'\\]+/gi,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SLACK_CHANNEL_PATTERN = /\b[CDG][A-Z0-9]{8,}\b/g;

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeKey(key));
}

export function looksLikeSecret(value: string): boolean {
  if (EMAIL_PATTERN.test(value) || SLACK_CHANNEL_PATTERN.test(value)) {
    EMAIL_PATTERN.lastIndex = 0;
    SLACK_CHANNEL_PATTERN.lastIndex = 0;
    return true;
  }
  EMAIL_PATTERN.lastIndex = 0;
  SLACK_CHANNEL_PATTERN.lastIndex = 0;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      pattern.lastIndex = 0;
      return true;
    }
    pattern.lastIndex = 0;
  }
  return false;
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
  if (EMAIL_PATTERN.test(text)) hits.push("email");
  EMAIL_PATTERN.lastIndex = 0;
  if (SLACK_CHANNEL_PATTERN.test(text)) hits.push("channel-id");
  SLACK_CHANNEL_PATTERN.lastIndex = 0;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      hits.push("token");
      pattern.lastIndex = 0;
      break;
    }
    pattern.lastIndex = 0;
  }
  return hits;
}
