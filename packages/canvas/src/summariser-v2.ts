// === FILE START ===
// packages/canvas/src/summariser-v2.ts
// PRD §14.5 · F-190 · T-13.
//
// Extractive summariser. Deterministic, model-free, zero external imports.
//
// Frequency-based: tokenise each sentence, drop stop words, count token
// frequency across the whole document, score each sentence by mean token
// frequency, then pick the top N sentences and restore original order.
//
// PRD §9.10: "Numbers come from counters, not from the model." So
// SummaryResult.stats reports real counts: sentences in the input, words in
// the input, sentences selected. Nothing is invented.
//
// FIX HISTORY (post Section 103):
//   splitSentences() previously filtered by s.length > 0, so pure-punctuation
//   fragments like '..' or '?!' survived. The semantic contract is that a
//   sentence must contain at least one letter or numeral (in any script).
//   Corrected to /[\p{L}\p{N}]/u.test(s) so Devanagari, Tamil, Arabic and
//   Latin all count as content, but pure punctuation is dropped.

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'this', 'that', 'these', 'those', 'it', 'its', 'for', 'with',
  'by', 'from', 'as', 'so', 'if', 'then', 'than', 'not', 'no',
]);

/**
 * Split text into sentences on . ! ? followed by whitespace, trim each
 * fragment, and drop anything without at least one letter or numeral.
 * '..' and '?!' are not sentences; 'Hi.' and 'नमस्ते।' are.
 */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string') return [];
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function tokenize(text: string): string[] {
  if (typeof text !== 'string') return [];
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

export function wordFrequency(sentences: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of tokenize(s)) {
      if (STOP_WORDS.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return freq;
}

export function sentenceScore(
  sentence: string,
  freq: Map<string, number>,
): number {
  const tokens = tokenize(sentence).filter((w) => !STOP_WORDS.has(w));
  if (tokens.length === 0) return 0;
  let sum = 0;
  for (const w of tokens) sum += freq.get(w) ?? 0;
  return sum / tokens.length;
}

export interface SummaryStats {
  sentences: number;
  words: number;
  selected: number;
}

export interface SummaryResult {
  summary: string[];
  stats: SummaryStats;
}

export interface SummariseOptions {
  maxSentences?: number;
}

export function summarise(text: string, opts: SummariseOptions = {}): SummaryResult {
  const maxSentences = opts.maxSentences ?? 5;
  const sentences = splitSentences(text);

  if (sentences.length === 0) {
    return { summary: [], stats: { sentences: 0, words: 0, selected: 0 } };
  }

  const freq = wordFrequency(sentences);
  const scored = sentences.map((s, i) => ({
    i,
    s,
    score: sentenceScore(s, freq),
  }));

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const top = scored.slice(0, maxSentences);
  top.sort((a, b) => a.i - b.i);

  const words = sentences.reduce((acc, s) => acc + tokenize(s).length, 0);

  return {
    summary: top.map((t) => t.s),
    stats: { sentences: sentences.length, words, selected: top.length },
  };
}
// === FILE END ===