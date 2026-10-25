// === FILE START ===
// packages/council-engine/test/debate.test.ts
// PRD §7.9 · FR-COUNCIL-04.

import { describe, it, expect } from 'vitest';
import { runDebate } from '../src/debate.js';
import type { CouncilSeat, ModelCaller } from '../src/real.js';

const yuki: CouncilSeat = { persona: 'yuki', model_family: 'groq', provider: 'groq' };
const kaito: CouncilSeat = { persona: 'kaito', model_family: 'gemini', provider: 'google' };

function caller(answers: Record<string, string>): ModelCaller {
  return async (req) => ({ text: answers[req.seat.persona] ?? '', tokens: 1 });
}

describe('debate — winner determination', () => {
  it('higher-evidence side wins', async () => {
    const r = await runDebate({
      question: 'x',
      position_a: 'yes',
      position_b: 'no',
      seat_a: yuki,
      seat_b: kaito,
      caller: caller({
        yuki: 'Study [1] shows 42% improvement. Data [2] confirms.',
        kaito: 'I disagree.',
      }),
    });
    expect(r.verdict.winning_side).toBe('a');
  });

  it('reverse: side b with more evidence wins', async () => {
    const r = await runDebate({
      question: 'x',
      position_a: 'yes',
      position_b: 'no',
      seat_a: yuki,
      seat_b: kaito,
      caller: caller({
        yuki: 'Nope.',
        kaito: 'Source [1] says 30% cheaper. Study [2] confirms.',
      }),
    });
    expect(r.verdict.winning_side).toBe('b');
  });

  it('both sides with no evidence → tie', async () => {
    const r = await runDebate({
      question: 'x',
      position_a: 'yes',
      position_b: 'no',
      seat_a: yuki,
      seat_b: kaito,
      caller: caller({
        yuki: 'yes',
        kaito: 'no',
      }),
    });
    expect(r.verdict.winning_side).toBe('tie');
  });

  it('uses exactly 2 calls', async () => {
    const r = await runDebate({
      question: 'x',
      position_a: 'yes',
      position_b: 'no',
      seat_a: yuki,
      seat_b: kaito,
      caller: caller({ yuki: 'y', kaito: 'n' }),
    });
    expect(r.calls_used).toBe(2);
  });

  it('rounds array contains both arguments', async () => {
    const r = await runDebate({
      question: 'x',
      position_a: 'yes',
      position_b: 'no',
      seat_a: yuki,
      seat_b: kaito,
      caller: caller({ yuki: 'Y-arg', kaito: 'N-arg' }),
    });
    expect(r.rounds[0]!.position_a_argument).toBe('Y-arg');
    expect(r.rounds[0]!.position_b_argument).toBe('N-arg');
  });
});
// === FILE END ===