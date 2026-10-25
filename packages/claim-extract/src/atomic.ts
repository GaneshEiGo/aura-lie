// === FILE START ===
// packages/claim-extract/src/atomic.ts
// PRD 8.3 step 1 · FR-TRUTH-01.
//
// Splits a draft answer into atomic claims. Conservative by design: only
// splits at boundaries that are unambiguous:
//   · . ! ? followed by whitespace + uppercase  (sentence boundary)
//   · ;                                          (sentence boundary)
//   · , and  , but  , so  , which                (coordinated clause boundary)
//
// Bare " and " NEVER splits — "Salt and pepper are spices" is one claim.
// Bare " because " NEVER splits — "The plant grew because of sunlight" is
// one causal claim that keeps its meaning intact.

const SPLIT_PATTERNS: RegExp[] = [
  /[.!?]\s+(?=[A-Z])/g,
  /;\s+/g,
  /,\s+and\s+/gi,
  /,\s+but\s+/gi,
  /,\s+so\s+/gi,
  /,\s+which\s+/gi,
];

const MIN_LENGTH = 5;

export function splitAtomic(text: string): string[] {
  const input = (text ?? '').trim();
  if (input.length === 0) return [];

  let parts: string[] = [input];

  for (const pattern of SPLIT_PATTERNS) {
    const next: string[] = [];
    for (const part of parts) {
      for (const sub of part.split(pattern)) {
        const t = sub.trim();
        if (t.length > 0) next.push(t);
      }
    }
    parts = next;
  }

  return parts
    .map((p) => p.replace(/[.!?;,]+$/, '').trim())
    .filter((p) => p.length >= MIN_LENGTH);
}
// === FILE END ===