// === FILE START ===
// packages/council-engine/test/t14-council.test.ts
// PRD §7.9 · FR-COUNCIL-01 · FR-COUNCIL-02 · FR-COUNCIL-06 · D-11.
//
// T-14 gate for the council subsystem:
//   · real council requires ≥ 2 seats and ≥ 2 distinct model families
//   · judge must be a different family from every seat
//   · dissent is shown with the dissenting seat index
//   · anti-theatre rule fires no_op when synthesis equals majority
//   · simulated council carries the exact PRD label
//   · simulated uses exactly 1 call; real uses seats + 1

import { describe, it, expect } from 'vitest';
import {
  runRealCouncil,
  CouncilError,
  type CouncilSeat,
  type ModelCaller,
  type ModelCallResponse,
} from '../src/real.js';
import { runSimulatedCouncil } from '../src/simulated.js';

function fakeCaller(answers: Record<string, string>): ModelCaller {
  return async (req): Promise<ModelCallResponse> => {
    const text = answers[req.seat.persona] ?? '';
    return { text, tokens: text.split(/\s+/).filter(Boolean).length };
  };
}

const yuki: CouncilSeat = { persona: 'yuki', model_family: 'groq', provider: 'groq' };
const kaito: CouncilSeat = { persona: 'kaito', model_family: 'gemini', provider: 'google' };
const rin: CouncilSeat = { persona: 'rin', model_family: 'cerebras', provider: 'cerebras' };
const judge: CouncilSeat = {
  persona: 'aura-lie',
  model_family: 'workers-ai',
  provider: 'cloudflare',
};

describe('T-14.1 — Real council requires ≥ 2 seats and ≥ 2 families', () => {
  it('rejects with only 1 seat', async () => {
    await expect(
      runRealCouncil({
        question: 'test',
        seats: [yuki],
        judge_seat: judge,
        caller: fakeCaller({}),
      }),
    ).rejects.toThrow(CouncilError);
  });

  it('rejects with 2 seats from the same family', async () => {
    await expect(
      runRealCouncil({
        question: 'test',
        seats: [
          { ...yuki },
          { ...kaito, model_family: 'groq' },
        ],
        judge_seat: judge,
        caller: fakeCaller({}),
      }),
    ).rejects.toThrow(/distinct model families/);
  });

  it('rejects when judge family matches a seat', async () => {
    await expect(
      runRealCouncil({
        question: 'test',
        seats: [yuki, kaito],
        judge_seat: { ...judge, model_family: 'groq' },
        caller: fakeCaller({}),
      }),
    ).rejects.toThrow(/Judge must be a different family/);
  });
});

describe('T-14.2 — Real council returns the real-family label', () => {
  it('label.kind is real and model_families lists every family', async () => {
    const r = await runRealCouncil({
      question: 'Should we ship Tuesday?',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'Yes.',
        kaito: 'Yes.',
        'aura-lie': 'Yes.',
      }),
    });
    expect(r.label.kind).toBe('real');
    if (r.label.kind === 'real') {
      expect(r.label.model_families.sort()).toEqual(['gemini', 'groq']);
    }
  });

  it('calls_used = seats + 1 (judge)', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito, rin],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(r.calls_used).toBe(4);
  });

  it('seats array preserves the persona / family / provider triple', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(r.seats[0]!.seat.persona).toBe('yuki');
    expect(r.seats[0]!.seat.model_family).toBe('groq');
    expect(r.seats[1]!.seat.model_family).toBe('gemini');
  });
});

describe('T-14.3 — Dissent is shown with the dissenting seat index', () => {
  it('unanimous answer → no dissent (null)', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito, rin],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'Yes.',
        kaito: 'Yes.',
        rin: 'Yes.',
        'aura-lie': 'SYNTHESIS: Yes.',
      }),
    });
    expect(r.verdict.dissent_seat_index).toBeNull();
    expect(r.verdict.dissent_reason).toBeNull();
  });

  it('one dissenter (rin at index 2) → dissent_seat_index = 2', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito, rin],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'Yes.',
        kaito: 'Yes.',
        rin: 'No.',
        'aura-lie': 'SYNTHESIS: Yes, with caveat.',
      }),
    });
    expect(r.verdict.dissent_seat_index).toBe(2);
    expect(r.verdict.dissent_reason).not.toBeNull();
  });
});

describe('T-14.4 — Anti-theatre no-op detection', () => {
  it('synthesis identical to majority → no_op = true', async () => {
    const r = await runRealCouncil({
      question: 'test',
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

  it('synthesis differs from majority → no_op = false', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({
        yuki: 'The answer is 42.',
        kaito: 'The answer is 42.',
        'aura-lie': 'The answer is 42, but only under assumption X.',
      }),
    });
    expect(r.no_op).toBe(false);
  });

  it('case + whitespace differences are normalised away', async () => {
    const r = await runRealCouncil({
      question: 'test',
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

describe('T-14.5 — Call budget', () => {
  it('refuses when seats + judge exceeds max_calls', async () => {
    await expect(
      runRealCouncil({
        question: 'test',
        seats: [yuki, kaito, rin],
        judge_seat: judge,
        caller: fakeCaller({}),
        max_calls: 3, // needs 4
      }),
    ).rejects.toThrow(/exceed call budget/);
  });

  it('default max_calls of 12 is honoured', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito, rin],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(r.calls_used).toBeLessThanOrEqual(12);
  });
});

describe('T-14.6 — Simulated council label and call count', () => {
  it('label carries the exact PRD string "Simulated dissent (single model)"', async () => {
    const r = await runSimulatedCouncil({
      question: 'test',
      personas: ['yuki', 'kaito'],
      model_family: 'workers-ai',
      provider: 'cloudflare',
      caller: fakeCaller({
        simulated: '[yuki] Yes.\n[kaito] Yes.\n[synthesis] Yes.',
      }),
    });
    expect(r.label.kind).toBe('simulated');
    if (r.label.kind === 'simulated') {
      expect(r.label.label).toBe('Simulated dissent (single model)');
    }
  });

  it('uses exactly 1 call, never more', async () => {
    let calls = 0;
    const caller: ModelCaller = async (req) => {
      calls += 1;
      return { text: '[yuki] ok\n[synthesis] ok', tokens: 2 };
    };
    const r = await runSimulatedCouncil({
      question: 'test',
      personas: ['yuki'],
      model_family: 'workers-ai',
      provider: 'cloudflare',
      caller,
    });
    expect(r.calls_used).toBe(1);
    expect(calls).toBe(1);
  });

  it('parses per-persona dialogue and the synthesis line', async () => {
    const r = await runSimulatedCouncil({
      question: 'test',
      personas: ['yuki', 'kaito', 'rin'],
      model_family: 'workers-ai',
      provider: 'cloudflare',
      caller: fakeCaller({
        simulated:
          '[yuki] Numbers work.\n[kaito] Risk is X.\n[rin] Do it.\n[synthesis] Do it with a buffer.',
      }),
    });
    expect(r.dialogue.length).toBe(3);
    expect(r.dialogue[0]!.persona).toBe('yuki');
    expect(r.dialogue[0]!.text).toBe('Numbers work.');
    expect(r.synthesis).toBe('Do it with a buffer.');
  });
});

describe('T-14.7 — Honesty rule: real is always labelled real, simulated is always labelled simulated', () => {
  it('real council label never contains "Simulated"', async () => {
    const r = await runRealCouncil({
      question: 'test',
      seats: [yuki, kaito],
      judge_seat: judge,
      caller: fakeCaller({ 'aura-lie': 'x' }),
    });
    expect(JSON.stringify(r.label)).not.toContain('Simulated');
  });

  it('simulated council label always contains "Simulated dissent (single model)"', async () => {
    const r = await runSimulatedCouncil({
      question: 'test',
      personas: ['yuki'],
      model_family: 'workers-ai',
      provider: 'cloudflare',
      caller: fakeCaller({ simulated: '[yuki] ok\n[synthesis] ok' }),
    });
    expect(JSON.stringify(r.label)).toContain('Simulated dissent (single model)');
  });
});
// === FILE END ===