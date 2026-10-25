// packages/memory-curator/src/secrets.ts
// PRD 9.5 privacy test: "Secrets and passwords are never stored."
// Defense-in-depth; this is not the primary secret guard (packages/security owns that).

const SECRET_PATTERNS: RegExp[] = [
  /\bpassword\s*[:=]\s*\S+/i,
  /\bpassphrase\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S+/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /\baccess[_-]?token\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bsk_live_[A-Za-z0-9]{12,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}