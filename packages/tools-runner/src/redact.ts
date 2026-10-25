// packages/tools-runner/src/redact.ts
// FR-SEC-02, FR-SEC-05, T-16. Scrub secrets before the model sees them.

interface RedactionPattern {
  re: RegExp;
  replacement: string;
}

const PATTERNS: RedactionPattern[] = [
  { re: /\bsk_live_[A-Za-z0-9]{12,}/g, replacement: '[REDACTED_STRIPE_LIVE_KEY]' },
  { re: /\bsk_test_[A-Za-z0-9]{12,}/g, replacement: '[REDACTED_STRIPE_TEST_KEY]' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_OPENAI_KEY]' },
  { re: /\bghp_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { re: /\bgho_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_OAUTH]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_ACCESS_KEY]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  {
    re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  { re: /\b(password|passphrase|secret)\s*[:=]\s*\S+/gi, replacement: '$1=[REDACTED]' },
  { re: /\bapi[_-]?key\s*[:=]\s*\S+/gi, replacement: 'api_key=[REDACTED]' },
];

export interface RedactResult {
  redacted: string;
  changed: boolean;
}

/**
 * Redact known secret patterns from `text`. Returns the redacted string plus
 * a `changed` flag so callers can note the redaction in the audit log.
 * Idempotent: running it twice produces the same output.
 */
export function redactSecrets(text: string): RedactResult {
  if (typeof text !== 'string') {
    return { redacted: '', changed: false };
  }
  let out = text;
  let changed = false;
  for (const { re, replacement } of PATTERNS) {
    re.lastIndex = 0;
    const next = out.replace(re, replacement);
    if (next !== out) {
      changed = true;
      out = next;
    }
  }
  return { redacted: out, changed };
}