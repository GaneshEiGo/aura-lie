// === FILE START ===
// packages/council-engine/test/second-opinion.test.ts
// PRD §7.9 · FR-WF-07.

import { describe, it, expect } from 'vitest';
import { runSecondOpinion } from '../src/second-opinion.js';
import type { CouncilSeat, ModelCaller } from '../src/real.js';

const kaito: CouncilSeat = { persona: 'kaito', model_family: 'gemini', provider: 'google' };

describe('second opinion — different family required', () => {
  it('refuses when opinion family matches the original', async () => {
    const caller: ModelCaller = async () => ({ text: 'x', tokens: 1 });
    await expect(
      runSecondOpinion({
        question: 'q',
        original_answer: 'a',
        original_family: 'gemini',
        opinion_seat: kaito,
        caller,
      }),
    ).rejects.toThrow(/different model family/);
  });
});

describe('second opinion — agreement matrix', () => {
  it('computes agreed and disputed claims', async () => {
    const caller: ModelCaller = async () => ({
      text: 'The sky is blue. Fire is cold.',
      tokens: 10,
    });
    const r = await runSecondOpinion({
      question: 'q',
      original_answer: 'The sky is blue. Water is wet.',
      original_family: 'groq',
      opinion_seat: kaito,
      caller,
    });
    expect(r.matrix.total_claims).toBe(2);
    expect(r.matrix.agreed_claims).toBe(1);
    expect(r.matrix.disputed_claims).toBe(1);
    expect(r.matrix.agreement_pct).toBe(50);
  });

  it('main_dispute is the first disputed claim', async () => {
    const caller: ModelCaller = async () => ({
      text: 'The sky is blue. Fire is cold.',
      tokens: 10,
    });
    const r = await runSecondOpinion({
      question: 'q',
      original_answer: 'The sky is blue. Water is wet.',
      original_family: 'groq',
      opinion_seat: kaito,
      caller,
    });
    expect(r.main_dispute).toBe('Water is wet');
  });

  it('100 percent agreement when all claims match', async () => {
    const caller: ModelCaller = async () => ({
      text: 'The sky is blue.',
      tokens: 4,
    });
    const r = await runSecondOpinion({
      question: 'q',
      original_answer: 'The sky is blue.',
      original_family: 'groq',
      opinion_seat: kaito,
      caller,
    });
    expect(r.matrix.agreement_pct).toBe(100);
    expect(r.main_dispute).toBeNull();
  });

  it('agreement_pct is null when original had 0 claims', async () => {
    const caller: ModelCaller = async () => ({ text: '...', tokens: 1 });
    const r = await runSecondOpinion({
      question: 'q',
      original_answer: '',
      original_family: 'groq',
      opinion_seat: kaito,
      caller,
    });
    expect(r.matrix.agreement_pct).toBeNull();
  });

  it('uses exactly 1 call', async () => {
    const caller: ModelCaller = async () => ({ text: 'x', tokens: 1 });
    const r = await runSecondOpinion({
      question: 'q',
      original_answer: 'x',
      original_family: 'groq',
      opinion_seat: kaito,
      caller,
    });
    expect(r.calls_used).toBe(1);
  });
});
// === FILE END ===