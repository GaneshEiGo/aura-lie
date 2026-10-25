// === FILE START ===
// packages/truth-score/test/quote-span.test.ts
// PRD 8.4 · F-033 · FR-TRUTH-04 · T-03.
//
// T-03 gate: 200 adversarial cases. Hard rule: 0 fabricated quotes displayed.
// "Displayed" = verifyQuoteSpan returned verified:true for a quote that is NOT
// actually a substring of the fetched page.
//
// 200 cases across 10 categories:
//   40 exact              → verified=true, kind=exact
//   20 whitespace         → verified=true, kind=normalized
//   20 case               → verified=true, kind=normalized
//   20 unicode            → verified=true, kind=normalized
//   20 paraphrased        → verified=false
//   20 near-match         → verified=false
//   20 wrong-page         → verified=false
//   20 invented           → verified=false
//   10 too-long           → verified=false, kind=too_long
//   10 edge cases         → verified=false

import { describe, it, expect } from 'vitest';
import {
  verifyQuoteSpan,
  normalizeForMatch,
  MAX_QUOTE_WORDS,
} from '../src/quote-span.js';
import type { QuoteMatchKind } from '../src/quote-span.js';

// =============================================================================
// Reference page — a real ~100-word passage about the Eiffel Tower
// =============================================================================

const PAGE =
  'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France. ' +
  'It is named after the engineer Gustave Eiffel, whose company designed and built the tower. ' +
  'The tower is 330 metres tall, making it the tallest structure in Paris. ' +
  "It was constructed from 1887 to 1889 as the entrance to the 1889 World's Fair. " +
  'The tower has three levels for visitors, with restaurants on the first and second levels. ' +
  "The top level's upper platform is 276 metres above the ground. " +
  'The tower received 5.9 million visitors in 2015. ' +
  'It is the most-visited paid monument in the world.';

const WORDS = PAGE.split(/\s+/);

/** Deterministic 5-8 word span from PAGE, indexed by i. */
function legitSpan(i: number): string {
  const start = (i * 3) % Math.max(1, WORDS.length - 6);
  const len = 5 + (i % 4);
  return WORDS.slice(start, start + len).join(' ');
}

interface Case {
  name: string;
  page: string;
  quote: string;
  shouldVerify: boolean;
  expectedKind?: QuoteMatchKind;
}

/** Replace one >3-char word in `span` with a fabricated token. */
function changeOneWord(span: string): string {
  const words = span.split(' ');
  for (let i = 0; i < words.length; i++) {
    if (words[i].length > 3 && /^[A-Za-z]/.test(words[i])) {
      const out = [...words];
      out[i] = 'xxxchangedxxx';
      return out.join(' ');
    }
  }
  return span + ' xxxchangedxxx';
}

// =============================================================================
// Build 200 cases
// =============================================================================

function buildCases(): Case[] {
  const cases: Case[] = [];

  // 40 exact
  for (let i = 0; i < 40; i++) {
    cases.push({
      name: `exact_${i}`,
      page: PAGE,
      quote: legitSpan(i),
      shouldVerify: true,
      expectedKind: 'exact',
    });
  }

  // 20 whitespace variants (extra spaces, no other change)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `ws_${i}`,
      page: PAGE,
      quote: '  ' + legitSpan(i).replace(/ /g, '   ') + '  ',
      shouldVerify: true,
      expectedKind: 'normalized',
    });
  }

  // 20 case variants (ALL UPPERCASE)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `case_${i}`,
      page: PAGE,
      quote: legitSpan(i).toUpperCase(),
      shouldVerify: true,
      expectedKind: 'normalized',
    });
  }

  // 20 unicode variants (em-dash + curly apostrophe + NBSP for every space)
  for (let i = 0; i < 20; i++) {
    const v = legitSpan(i)
      .replace(/-/g, '\u2013')
      .replace(/'/g, '\u2019')
      .replace(/ /g, '\u00A0');
    cases.push({
      name: `unicode_${i}`,
      page: PAGE,
      quote: v,
      shouldVerify: true,
      expectedKind: 'normalized',
    });
  }

  // 20 paraphrased (one >3-char word replaced)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `para_${i}`,
      page: PAGE,
      quote: changeOneWord(legitSpan(i)),
      shouldVerify: false,
    });
  }

  // 20 near-match (legit span + extra trailing word)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `near_${i}`,
      page: PAGE,
      quote: legitSpan(i) + ' extra',
      shouldVerify: false,
    });
  }

  // 20 wrong-page (quotes that don't appear in PAGE)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `wrong_${i}`,
      page: PAGE,
      quote: `Quantum physics is hard (${i})`,
      shouldVerify: false,
    });
  }

  // 20 invented (obviously hallucinated)
  for (let i = 0; i < 20; i++) {
    cases.push({
      name: `inv_${i}`,
      page: PAGE,
      quote: `The Eiffel Tower was built by aliens in ${1850 + i}`,
      shouldVerify: false,
    });
  }

  // 10 too-long (26..35 words)
  for (let i = 0; i < 10; i++) {
    cases.push({
      name: `long_${i}`,
      page: PAGE,
      quote: Array(MAX_QUOTE_WORDS + 1 + i).fill('word').join(' '),
      shouldVerify: false,
      expectedKind: 'too_long',
    });
  }

  // 10 edge cases
  cases.push({ name: 'edge_empty', page: PAGE, quote: '', shouldVerify: false, expectedKind: 'empty' });
  cases.push({ name: 'edge_ws', page: PAGE, quote: '   ', shouldVerify: false, expectedKind: 'empty' });
  cases.push({ name: 'edge_no_page', page: '', quote: 'some quote', shouldVerify: false, expectedKind: 'no_page' });
  cases.push({ name: 'edge_no_page_ws', page: '   ', quote: 'some quote', shouldVerify: false, expectedKind: 'no_page' });
  cases.push({ name: 'edge_off', page: PAGE, quote: changeOneWord(legitSpan(0)), shouldVerify: false });
  cases.push({ name: 'edge_reverse', page: PAGE, quote: legitSpan(1).split(' ').reverse().join(' '), shouldVerify: false });
  cases.push({ name: 'edge_rand1', page: PAGE, quote: 'zzqqwweerrtt', shouldVerify: false });
  cases.push({ name: 'edge_rand2', page: PAGE, quote: 'qwertyuiop', shouldVerify: false });
  cases.push({ name: 'edge_rand3', page: PAGE, quote: 'asdfghjklzxcvbnm', shouldVerify: false });
  cases.push({ name: 'edge_rand4', page: PAGE, quote: 'zzzzzzz', shouldVerify: false });

  return cases;
}

// =============================================================================
// T-03 gate
// =============================================================================

describe('T-03 — 200 adversarial cases, 0 fabricated quotes displayed', () => {
  it('corpus is exactly 200 cases', () => {
    expect(buildCases().length).toBe(200);
  });

  it('all "should verify" cases verify; all "should not" cases are rejected', () => {
    const cases = buildCases();
    let verifiedOK = 0;
    let rejectedOK = 0;
    let fabricated = 0;
    const failures: string[] = [];

    for (const c of cases) {
      const result = verifyQuoteSpan(c.page, c.quote);
      if (c.shouldVerify) {
        if (result.verified) verifiedOK++;
        else failures.push(`SHOULD_VERIFY "${c.name}": got ${result.matchKind}`);
      } else {
        if (result.verified) {
          fabricated++;
          failures.push(`FABRICATED "${c.name}": ${c.quote.slice(0, 60)}`);
        } else rejectedOK++;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`T-03: ${verifiedOK} verified, ${rejectedOK} rejected, ${fabricated} FABRICATED (need 0)`);
    if (failures.length > 0) console.log('\nFailures:\n' + failures.join('\n'));

    expect(fabricated).toBe(0);
    expect(failures.length).toBe(0);
    expect(verifiedOK + rejectedOK).toBe(200);
  });

  it('exactly 100 legitimate / normalized cases all verify', () => {
    const cases = buildCases().filter((c) => c.shouldVerify);
    expect(cases.length).toBe(100);
    for (const c of cases) {
      expect(verifyQuoteSpan(c.page, c.quote).verified).toBe(true);
    }
  });

  it('exactly 100 adversarial cases all rejected', () => {
    const cases = buildCases().filter((c) => !c.shouldVerify);
    expect(cases.length).toBe(100);
    for (const c of cases) {
      expect(verifyQuoteSpan(c.page, c.quote).verified).toBe(false);
    }
  });

  it('expected kinds are returned for structural cases', () => {
    const cases = buildCases().filter((c) => c.expectedKind !== undefined);
    const failures: string[] = [];
    for (const c of cases) {
      const r = verifyQuoteSpan(c.page, c.quote);
      if (r.matchKind !== c.expectedKind) {
        failures.push(`${c.name}: expected ${c.expectedKind}, got ${r.matchKind}`);
      }
    }
    if (failures.length > 0) console.log('\nKind failures:\n' + failures.join('\n'));
    expect(failures.length).toBe(0);
  });
});

// =============================================================================
// verifyQuoteSpan — structural tests
// =============================================================================

describe('verifyQuoteSpan — structural', () => {
  it('exact substring returns kind="exact", normalizedMatch=false', () => {
    const r = verifyQuoteSpan('The quick brown fox jumps', 'quick brown fox');
    expect(r.verified).toBe(true);
    expect(r.normalizedMatch).toBe(false);
    expect(r.matchKind).toBe('exact');
  });

  it('whitespace-only difference returns kind="normalized"', () => {
    const r = verifyQuoteSpan('The quick brown fox', 'The   quick   brown   fox');
    expect(r.verified).toBe(true);
    expect(r.normalizedMatch).toBe(true);
    expect(r.matchKind).toBe('normalized');
  });

  it('case difference returns kind="normalized"', () => {
    const r = verifyQuoteSpan('The quick brown fox', 'the QUICK brown FOX');
    expect(r.verified).toBe(true);
    expect(r.matchKind).toBe('normalized');
  });

  it('curly quotes vs straight quotes returns kind="normalized"', () => {
    const r = verifyQuoteSpan('He said "hello world"', 'He said \u201Chello world\u201D');
    expect(r.verified).toBe(true);
    expect(r.matchKind).toBe('normalized');
  });

  it('empty quote returns kind="empty" with wordCount=0', () => {
    const r = verifyQuoteSpan('page text', '');
    expect(r.verified).toBe(false);
    expect(r.matchKind).toBe('empty');
    expect(r.wordCount).toBe(0);
  });

  it('too-long quote returns kind="too_long"', () => {
    const long = Array(MAX_QUOTE_WORDS + 5).fill('word').join(' ');
    const r = verifyQuoteSpan('page text', long);
    expect(r.verified).toBe(false);
    expect(r.matchKind).toBe('too_long');
    expect(r.wordCount).toBeGreaterThan(MAX_QUOTE_WORDS);
  });

  it('empty page returns kind="no_page"', () => {
    const r = verifyQuoteSpan('', 'some quote');
    expect(r.verified).toBe(false);
    expect(r.matchKind).toBe('no_page');
  });

  it('whitespace-only page returns kind="no_page"', () => {
    const r = verifyQuoteSpan('    ', 'some quote');
    expect(r.verified).toBe(false);
    expect(r.matchKind).toBe('no_page');
  });

  it('unknown quote returns not_found or paraphrase', () => {
    const r = verifyQuoteSpan('The quick brown fox', 'totally unrelated text');
    expect(r.verified).toBe(false);
    expect(['not_found', 'paraphrase']).toContain(r.matchKind);
  });

  it('24-word quote within cap is accepted', () => {
    const text24 = Array(24).fill('word').join(' ');
    const r = verifyQuoteSpan('prefix ' + text24 + ' suffix', text24);
    expect(r.verified).toBe(true);
    expect(r.wordCount).toBe(24);
  });

  it('25-word quote is exactly at cap and accepted', () => {
    const text25 = Array(25).fill('word').join(' ');
    const r = verifyQuoteSpan('prefix ' + text25 + ' suffix', text25);
    expect(r.verified).toBe(true);
    expect(r.wordCount).toBe(25);
  });

  it('26-word quote exceeds cap', () => {
    const text26 = Array(26).fill('word').join(' ');
    const r = verifyQuoteSpan('prefix ' + text26 + ' suffix', text26);
    expect(r.verified).toBe(false);
    expect(r.matchKind).toBe('too_long');
  });
});

// =============================================================================
// normalizeForMatch
// =============================================================================

describe('normalizeForMatch', () => {
  it('collapses runs of whitespace to single space', () => {
    expect(normalizeForMatch('a   b\tc\nd')).toBe('a b c d');
  });

  it('lowercases', () => {
    expect(normalizeForMatch('HELLO World')).toBe('hello world');
  });

  it('converts curly double quotes to straight', () => {
    expect(normalizeForMatch('\u201Chello\u201D')).toBe('"hello"');
  });

  it('converts em-dash to hyphen', () => {
    expect(normalizeForMatch('a\u2014b')).toBe('a-b');
  });

  it('converts NBSP to regular space', () => {
    expect(normalizeForMatch('a\u00A0b')).toBe('a b');
  });

  it('removes zero-width characters', () => {
    expect(normalizeForMatch('a\u200Bb')).toBe('ab');
  });

  it('empty input returns empty', () => {
    expect(normalizeForMatch('')).toBe('');
  });

  it('whitespace-only input returns empty', () => {
    expect(normalizeForMatch('   ')).toBe('');
  });
});
// === FILE END ===