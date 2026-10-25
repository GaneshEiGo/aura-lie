// === FILE START ===
// packages/canvas/test/summariser-v2.test.ts
// PRD §14.5 · F-190 · T-13.

import { describe, it, expect } from 'vitest';
import {
  splitSentences,
  tokenize,
  wordFrequency,
  sentenceScore,
  summarise,
  STOP_WORDS,
} from '../src/summariser-v2.js';

describe('summariser — sentence splitting', () => {
  it('splits on . ! ? and preserves punctuation', () => {
    const s = splitSentences('First one. Second one! Third one?');
    expect(s).toEqual(['First one.', 'Second one!', 'Third one?']);
  });

  it('drops empty strings', () => {
    expect(splitSentences('  ..  ')).toEqual([]);
    expect(splitSentences('')).toEqual([]);
  });
});

describe('summariser — tokenisation', () => {
  it('lowercases and strips punctuation except apostrophes', () => {
    expect(tokenize("Hello, World! It's fine.")).toEqual([
      'hello', 'world', "it's", 'fine',
    ]);
  });

  it('returns empty array for non-string input', () => {
    // @ts-expect-error deliberate invalid input
    expect(tokenize(null)).toEqual([]);
  });
});

describe('summariser — wordFrequency', () => {
  it('counts non-stop words across sentences', () => {
    const freq = wordFrequency(['the cat sat', 'the cat ran']);
    expect(freq.get('cat')).toBe(2);
    expect(freq.get('sat')).toBe(1);
    expect(freq.get('ran')).toBe(1);
  });

  it('skips every stop word', () => {
    const freq = wordFrequency(['the a an and or but']);
    for (const stop of STOP_WORDS) {
      expect(freq.get(stop)).toBeUndefined();
    }
  });
});

describe('summariser — sentenceScore', () => {
  it('favours sentences containing frequent non-stop words', () => {
    const freq = new Map([
      ['battery', 5],
      ['graph', 1],
    ]);
    const s1 = sentenceScore('battery battery battery', freq);
    const s2 = sentenceScore('graph graph graph', freq);
    expect(s1).toBeGreaterThan(s2);
  });

  it('returns 0 for sentences made only of stop words', () => {
    const freq = new Map<string, number>();
    expect(sentenceScore('the a an and', freq)).toBe(0);
  });
});

describe('summariser — summarise', () => {
  const doc =
    'The battery is the key topic. Battery life matters most to users. ' +
    'A rare word appears here. Another rare word too.';

  it('returns empty result for empty input', () => {
    const r = summarise('');
    expect(r.summary).toEqual([]);
    expect(r.stats).toEqual({ sentences: 0, words: 0, selected: 0 });
  });

  it('selects at most maxSentences sentences', () => {
    const r = summarise(doc, { maxSentences: 2 });
    expect(r.summary.length).toBe(2);
    expect(r.stats.selected).toBe(2);
  });

  it('reports real word and sentence counts in stats', () => {
    const r = summarise(doc);
    expect(r.stats.sentences).toBe(4);
    expect(r.stats.words).toBeGreaterThan(0);
    expect(r.stats.words).toBe(
      doc.split(/\s+/).filter((w) => w.length > 0).length,
    );
  });

  it('is deterministic (identical output twice)', () => {
    const a = summarise(doc);
    const b = summarise(doc);
    expect(a.summary).toEqual(b.summary);
    expect(a.stats).toEqual(b.stats);
  });

  it('source scan: summariser-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'summariser-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===