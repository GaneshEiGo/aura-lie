// === FILE START ===
// packages/claim-extract/test/claim-extraction.test.ts
// PRD 8.3 · F-031 · T-05.
// Gate: F1 ≥ 0.80 on a 50-sentence labelled corpus.

import { describe, it, expect } from 'vitest';
import { extractClaims } from '../src/extract.js';
import { splitAtomic } from '../src/atomic.js';
import { classifyClaim } from '../src/classify.js';
import type { ClaimType } from '../src/types.js';

// =============================================================================
// 50-case labelled corpus
// =============================================================================

interface CorpusCase {
  text: string;
  expectedClaims: number;
  expectedCheckable: number;
  expectedFirstType: ClaimType;
}

const CASES: CorpusCase[] = [
  // 20 single-claim cases
  { text: 'The Eiffel Tower is 330 metres tall.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'Paris is the capital of France.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'Water boils at 100 degrees Celsius.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'The moon orbits the Earth.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'I think Paris is beautiful.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'opinion' },
  { text: 'Python was created by Guido van Rossum.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'The sky is blue.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: '5 + 5 = 10.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'The Pacific is the largest ocean.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'comparison' },
  { text: 'Einstein published his theory of relativity in 1915.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'date' },
  { text: 'The Great Wall of China is over 21,000 kilometers long.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'Mount Everest is 8,848 metres tall.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'Shakespeare wrote Hamlet.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'The chemical formula for water is H2O.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'definition' },
  { text: 'The Earth is approximately 4.5 billion years old.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'The euro was introduced in 1999.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'date' },
  { text: 'Chocolate contains theobromine.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'The speed of light is 299,792,458 metres per second.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'Jupiter is larger than Earth.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'comparison' },
  { text: 'The human heart pumps blood through the body.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },

  // 15 multi-claim cases
  { text: 'Paris is in France; London is in England.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Water boils at 100\u00B0C. Ice melts at 0\u00B0C.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'numeric' },
  { text: 'The Earth orbits the Sun, and the Moon orbits the Earth.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'The sky is blue, but the ocean is green.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Python is a programming language, and JavaScript is a programming language.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'definition' },
  { text: 'The Eiffel Tower is in Paris, and it was built in 1889.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'The report is 20 pages long. It was written by Alice.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'numeric' },
  { text: 'The chemical symbol for gold is Au. Silver is Ag.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'definition' },
  { text: 'Mars has 2 moons; Venus has none.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'numeric' },
  { text: 'Mount Everest is in Nepal, and K2 is in Pakistan.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Coffee contains caffeine, and tea contains theanine.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Tokyo is the capital of Japan; Beijing is the capital of China.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'The meeting is on Monday, and the deadline is Friday.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Salt is sodium chloride, and sugar is sucrose.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },
  { text: 'Mars is red, and Venus is hot.', expectedClaims: 2, expectedCheckable: 2, expectedFirstType: 'entity-relation' },

  // 5 causal cases
  { text: 'The plant grew because it received more sunlight.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'causal' },
  { text: 'Our revenue grew 12% because of the new campaign.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'causal' },
  { text: 'The bridge collapsed due to structural failure.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'causal' },
  { text: 'He failed the exam because he did not study.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'causal' },
  { text: 'Sales dropped sharply, because customer demand fell.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'causal' },

  // 5 opinion / forecast cases
  { text: 'I believe AI will change everything.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'opinion' },
  { text: 'In my opinion, the movie was boring.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'opinion' },
  { text: 'The stock will rise next month.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'forecast' },
  { text: 'AI will replace many jobs by 2030.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'forecast' },
  { text: 'I think chocolate is delicious.', expectedClaims: 1, expectedCheckable: 0, expectedFirstType: 'opinion' },

  // 5 bare-and safety cases (must NOT split)
  { text: 'Salt and pepper are spices.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'Cats and dogs are common pets.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'Shakespeare wrote plays and poems.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'entity-relation' },
  { text: 'The number is 42.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'numeric' },
  { text: 'The rules changed in January 2024.', expectedClaims: 1, expectedCheckable: 1, expectedFirstType: 'date' },
];

// =============================================================================
// T-05 gate
// =============================================================================

describe('T-05 claim extraction gate — 50 labelled cases', () => {
  it('corpus has exactly 50 labelled cases', () => {
    expect(CASES.length).toBe(50);
  });

  it('F1 on the corpus is at least 0.80', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const failures: string[] = [];

    for (const c of CASES) {
      const claims = extractClaims(c.text);
      const actualCount = claims.length;
      const actualCheckable = claims.filter((cl) => cl.checkable).length;

      if (actualCount === c.expectedClaims && actualCheckable === c.expectedCheckable) {
        tp += 1;
      } else if (actualCount > c.expectedClaims) {
        fp += 1;
        failures.push(`OVER "${c.text}": got ${actualCount}, expected ${c.expectedClaims}`);
      } else if (actualCount < c.expectedClaims) {
        fn += 1;
        failures.push(`UNDER "${c.text}": got ${actualCount}, expected ${c.expectedClaims}`);
      } else {
        fn += 1;
        failures.push(`CHECKABLE "${c.text}": got ${actualCheckable}, expected ${c.expectedCheckable}`);
      }
    }

    if (failures.length > 0) console.log('\nT-05 failures:\n' + failures.join('\n'));

    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);

    // eslint-disable-next-line no-console
    console.log(
      `T-05: TP=${tp}, FP=${fp}, FN=${fn}, Precision=${p.toFixed(3)}, Recall=${r.toFixed(3)}, F1=${f1.toFixed(3)}`,
    );
    expect(f1).toBeGreaterThanOrEqual(0.80);
  });

  it('every case produces the expected first-claim type', () => {
    const failures: string[] = [];
    for (const c of CASES) {
      const claims = extractClaims(c.text);
      if (claims.length === 0) {
        failures.push(`EMPTY "${c.text}"`);
        continue;
      }
      if (claims[0].type !== c.expectedFirstType) {
        failures.push(`TYPE "${c.text}": got ${claims[0].type}, expected ${c.expectedFirstType}`);
      }
    }
    if (failures.length > 0) console.log('\nT-05 type failures:\n' + failures.join('\n'));
    expect(failures.length).toBe(0);
  });
});

// =============================================================================
// extractClaims — shape
// =============================================================================

describe('extractClaims — shape and defaults', () => {
  it('empty input returns empty array', () => {
    expect(extractClaims('')).toEqual([]);
    expect(extractClaims('   ')).toEqual([]);
  });

  it('very short input returns empty (below MIN_LENGTH)', () => {
    expect(extractClaims('hi')).toEqual([]);
  });

  it('each claim has a unique id', () => {
    const claims = extractClaims('Paris is in France. London is in England.');
    expect(claims.length).toBe(2);
    expect(claims[0].id).not.toBe(claims[1].id);
  });

  it('messageId is preserved when supplied', () => {
    const claims = extractClaims('Paris is in France.', { messageId: 'msg-42' });
    expect(claims[0].messageId).toBe('msg-42');
  });

  it('default messageId is "msg"', () => {
    const claims = extractClaims('Paris is in France.');
    expect(claims[0].messageId).toBe('msg');
  });

  it('default origin is MODEL', () => {
    const claims = extractClaims('Paris is in France.');
    expect(claims[0].origin).toBe('MODEL');
  });

  it('origin override is respected', () => {
    const claims = extractClaims('Paris is in France.', { origin: 'USER' });
    expect(claims[0].origin).toBe('USER');
  });

  it('first claim is central, rest are supporting', () => {
    const claims = extractClaims('Paris is in France. London is in England. Rome is in Italy.');
    expect(claims.length).toBe(3);
    expect(claims[0].importance).toBe('central');
    expect(claims[1].importance).toBe('supporting');
    expect(claims[2].importance).toBe('supporting');
  });

  it('cap truncates the output', () => {
    const text = Array(10).fill('Paris is in France.').join(' ');
    const claims = extractClaims(text, { cap: 3 });
    expect(claims.length).toBe(3);
  });

  it('opinion and forecast claims are not checkable', () => {
    const o = extractClaims('I think Paris is beautiful.');
    expect(o[0].checkable).toBe(false);
    expect(o[0].type).toBe('opinion');

    const f = extractClaims('The stock will rise tomorrow.');
    expect(f[0].checkable).toBe(false);
    expect(f[0].type).toBe('forecast');
  });

  it('factual claims are checkable', () => {
    const claims = extractClaims('Paris is in France.');
    expect(claims[0].checkable).toBe(true);
  });
});

// =============================================================================
// splitAtomic — safe boundaries
// =============================================================================

describe('splitAtomic — boundaries', () => {
  it('splits on period followed by uppercase', () => {
    expect(splitAtomic('A is true. B is true.')).toEqual(['A is true', 'B is true']);
  });

  it('splits on semicolon', () => {
    expect(splitAtomic('A is true; B is true.')).toEqual(['A is true', 'B is true']);
  });

  it('splits on comma-and', () => {
    expect(splitAtomic('A is true, and B is true.')).toEqual(['A is true', 'B is true']);
  });

  it('splits on comma-but', () => {
    expect(splitAtomic('A is true, but B is false.')).toEqual(['A is true', 'B is false']);
  });

  it('does NOT split on bare and', () => {
    expect(splitAtomic('Salt and pepper are spices.')).toEqual(['Salt and pepper are spices']);
  });

  it('does NOT split on bare because', () => {
    expect(splitAtomic('The plant grew because of sunlight.')).toEqual(['The plant grew because of sunlight']);
  });
});

// =============================================================================
// classifyClaim — shape
// =============================================================================

describe('classifyClaim — type detection', () => {
  it('numeric', () => {
    expect(classifyClaim('The tower is 330 metres tall').type).toBe('numeric');
  });
  it('date', () => {
    expect(classifyClaim('Published in 1915').type).toBe('date');
  });
  it('comparison', () => {
    expect(classifyClaim('Jupiter is larger than Earth').type).toBe('comparison');
  });
  it('causal', () => {
    expect(classifyClaim('Sales fell because demand dropped').type).toBe('causal');
  });
  it('opinion is not checkable', () => {
    const r = classifyClaim('I think the movie is boring');
    expect(r.type).toBe('opinion');
    expect(r.checkable).toBe(false);
  });
  it('forecast is not checkable', () => {
    const r = classifyClaim('The stock will rise tomorrow');
    expect(r.type).toBe('forecast');
    expect(r.checkable).toBe(false);
  });
  it('definition', () => {
    expect(classifyClaim('Python is a language').type).toBe('definition');
  });
  it('defaults to entity-relation', () => {
    expect(classifyClaim('Paris is in France').type).toBe('entity-relation');
  });
});
// === FILE END ===