// packages/tools-runner/src/fence.ts
// PRD 12.4, Law L9. Untrusted external content is wrapped so the model
// treats it as data, never instructions.

const OPEN = '<external>';
const CLOSE = '</external>';

/**
 * Wrap `text` between `<external>…</external>`. Any pre-existing `<external>`
 * tags are stripped first to prevent fence-escape via injection.
 */
export function fenceUntrustedOutput(text: string): string {
  const cleaned = String(text ?? '').replace(/<\/?external\b[^>]*>/gi, '');
  return `${OPEN}${cleaned}${CLOSE}`;
}

export function isFenced(text: string): boolean {
  return (
    typeof text === 'string' &&
    text.startsWith(OPEN) &&
    text.endsWith(CLOSE) &&
    text.length >= OPEN.length + CLOSE.length
  );
}