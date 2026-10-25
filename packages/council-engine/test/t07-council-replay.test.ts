// === FILE START ===
// packages/council-engine/test/t07-council-replay.test.ts
// PRD §7.9 anti-theatre rule · FR-TRUTH-16 answer versions · T-07.
//
// T-07 gate for council replay:
//   · no-op council is flagged and can be hidden
//   · determinism: two identical runs produce identical no_op / dissent
//   · no-op runs are not downgraded in labelling (still "real")
//   · seat results carry everything needed to replay the trace

import { describe, it, expect } from 'vitest';
import {
  runRealCouncil,
  type CouncilSeat,
  type ModelCaller,
  type ModelCallResponse,
} from '../src/real.js';

function fakeCaller(answers: Record<string, string>): ModelCaller {
  return async (req): Promise<ModelCallResponse> => {
    const text = answers[req.seat.persona] ?? '';
    return { text, tokens: text.split(/\s+/).filter(Boolean).length };
  };
}

const yuki: CouncilSeat = { persona: 'yuki', model_family: 'groq', provider: 'groq' };
const kaito: CouncilSeat = { persona: 'kaito', model_family: 'gemini', provider: 'google' };
const judge: CouncilSeat = {
  persona: 'aura-lie',
  model_family: 'workers-ai',
  provider: 'cloudflare',
};

describe('T-07.1 — Council no-op rule (anti-theatre)', () => {
  it('synthesis identical to answers → no_op = true (hide from user)', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'The answer is 42.',
        kaito: 'The answer is 42.',
        'aura-lie': 'The answer is 42.',
      }),
    });
    expect(r.no_op).toBe(true);
  });

  it('synthesis adds context → no_op = false (show to user)', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'The answer is 42.',
        kaito: 'The answer is 42.',
        'aura-lie': 'The answer is 42, assuming base 10.',
      }),
    });
    expect(r.no_op).toBe(false);
  });

  it('case and whitespace do not count as changes', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'The Answer Is 42.',
        kaito: 'the answer is 42.',
        'aura-lie': 'THE   ANSWER   IS   42.',
      }),
    });
    expect(r.no_op).toBe(true);
  });
});

describe('T-07.2 — Determinism', () => {
  it('two identical runs give identical no_op', async () => {
    const answers = {
      yuki: 'Yes.',
      kaito: 'Yes.',
      'aura-lie': 'Yes, definitely.',
    };
    const r1 = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller(answers),
    });
    const r2 = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller(answers),
    });
    expect(r1.no_op).toBe(r2.no_op);
  });

  it('two identical runs give identical dissent_seat_index', async () => {
    const answers = {
      yuki: 'Yes.',
      kaito: 'No.',
      'aura-lie': 'Yes, with caveat.',
    };
    const r1 = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller(answers),
    });
    const r2 = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller(answers),
    });
    expect(r1.verdict.dissent_seat_index).toBe(r2.verdict.dissent_seat_index);
  });
});

describe('T-07.3 — Labelling integrity (no-op is still real)', () => {
  it('no-op council still carries the real label', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'Same.',
        kaito: 'Same.',
        'aura-lie': 'Same.',
      }),
    });
    expect(r.label.kind).toBe('real');
  });

  it('calls_used is always ≥ seats + 1', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(r.calls_used).toBeGreaterThanOrEqual(3);
  });
});

describe('T-07.4 — Replay trace integrity', () => {
  it('every seat result carries the persona metadata', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(r.seats.length).toBe(2);
    expect(r.seats[0]!.seat.persona).toBe('yuki');
    expect(r.seats[1]!.seat.persona).toBe('kaito');
  });

  it('every seat result carries its own token count', async () => {
    const r = await runRealCouncil({
      question: 'x',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'one two three',
        kaito: 'one two three four five',
        'aura-lie': 'x',
      }),
    });
    expect(r.seats[0]!.tokens).toBe(3);
    expect(r.seats[1]!.tokens).toBe(5);
  });
});
// === FILE END ===