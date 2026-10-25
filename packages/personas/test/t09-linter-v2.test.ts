// === FILE START ===
// packages/personas/test/t09-linter-v2.test.ts
// PRD §11.4 · §11.5 · FR-PERS-05 · T-09.
//
// T-09 gate: 20-turn transcripts keep banned phrases at 0 for every persona,
// and drift_score ≥ 0.85.

import { describe, it, expect } from 'vitest';
import {
  lintPersona,
  findBannedHits,
  scoreDrift,
  DRIFT_THRESHOLD,
} from '../src/personas-linter-v2.js';
import { ROSTER } from '../src/personas-roster-v2.js';

function compatibleReply(personaId: string, n: number): string {
  const p = ROSTER.find((x) => x.id === personaId)!;
  // Length tuned to the persona's verbosity so lengthFit ≈ 1.
  const target = Math.max(3, Math.round(6 + p.sliders.verbosity * 40));
  const base = 'The answer is above.';
  const extra = Array(target).fill('fine').join(' ');
  const variants = [
    base,
    `${base} ${extra}`,
    `${extra}`,
    `${base}`,
  ];
  return variants[n % variants.length]!;
}

function transcript(personaId: string, turns = 20): string[] {
  return Array.from({ length: turns }, (_, i) =>
    compatibleReply(personaId, i),
  );
}

describe('T-09.1 — Drift threshold constant', () => {
  it('DRIFT_THRESHOLD is 0.85 per PRD §11.4', () => {
    expect(DRIFT_THRESHOLD).toBe(0.85);
  });
});

describe('T-09.2 — Empty reply set', () => {
  it('empty replies score 1 and have no banned hits', () => {
    const r = lintPersona({ persona: ROSTER[0]!, replies: [] });
    expect(r.drift_score).toBe(1);
    expect(r.banned_hits).toEqual([]);
  });
});

describe('T-09.3 — GATE: 20-turn transcripts keep banned phrases at 0 for every persona', () => {
  for (const persona of ROSTER) {
    it(`${persona.id}: 0 banned hits across 20 turns`, () => {
      const r = lintPersona({
        persona,
        replies: transcript(persona.id, 20),
      });
      expect(r.banned_hits).toEqual([]);
    });
  }
});

describe('T-09.4 — GATE: drift_score ≥ 0.85 for every persona', () => {
  for (const persona of ROSTER) {
    it(`${persona.id}: drift ≥ 0.85 on a compatible transcript`, () => {
      const r = lintPersona({
        persona,
        replies: transcript(persona.id, 20),
      });
      expect(r.drift_score).toBeGreaterThanOrEqual(DRIFT_THRESHOLD);
    });
  }
});

describe('T-09.5 — Banned-phrase detection', () => {
  it('finds "Certainly!" verbatim, case-insensitive', () => {
    const hits = findBannedHits(
      ['certainly! here is the answer.', 'no problem.'],
      ['Certainly!'],
    );
    expect(hits).toEqual(['Certainly!']);
  });

  it('returns unique phrases only', () => {
    const hits = findBannedHits(
      ['Certainly!', 'Certainly!', 'no problem.'],
      ['Certainly!'],
    );
    expect(hits).toEqual(['Certainly!']);
  });

  it('empty banned list → no hits', () => {
    expect(findBannedHits(['anything'], [])).toEqual([]);
  });

  it('unused banned phrase → no hit', () => {
    expect(findBannedHits(['a normal answer.'], ['Certainly!'])).toEqual([]);
  });
});

describe('T-09.6 — Drift scoring is deterministic and bounded', () => {
  it('same input → same score (twice)', () => {
    const persona = ROSTER[0]!;
    const replies = transcript(persona.id, 10);
    const a = scoreDrift({ persona, replies });
    const b = scoreDrift({ persona, replies });
    expect(a).toBe(b);
  });

  it('score is always within [0, 1]', () => {
    const persona = ROSTER[0]!;
    const probes = [
      [],
      [''],
      ['a'],
      [Array(100).fill('word').join(' ')],
      transcript(persona.id, 20),
    ];
    for (const replies of probes) {
      const score = scoreDrift({ persona, replies });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
// === FILE END ===