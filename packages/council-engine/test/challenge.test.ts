// === FILE START ===
// packages/council-engine/test/challenge.test.ts
// PRD §7.9 · FR-TRUTH-15.

import { describe, it, expect } from 'vitest';
import { runChallenge, runChangeMyMind } from '../src/challenge.js';
import type { CouncilSeat, ModelCaller } from '../src/real.js';

const judge: CouncilSeat = {
  persona: 'aura-lie',
  model_family: 'workers-ai',
  provider: 'cloudflare',
};

describe('challenge — parse weaknesses', () => {
  it('extracts 3 weaknesses with kinds and severities', async () => {
    const caller: ModelCaller = async () => ({
      text: [
        'ASSUMPTION HIGH: Assumes prices stay flat.',
        'EVIDENCE MEDIUM: Only one source.',
        'LOGIC LOW: Skips the zero case.',
        'REPAIR: Add a sensitivity test.',
      ].join('\n'),
      tokens: 20,
    });
    const r = await runChallenge({
      question: 'x',
      original_answer: 'y',
      challenge_seat: judge,
      caller,
    });
    expect(r.weaknesses.length).toBe(3);
    expect(r.weaknesses[0]!.kind).toBe('assumption');
    expect(r.weaknesses[0]!.severity).toBe('high');
    expect(r.repair_hint).toBe('Add a sensitivity test.');
  });

  it('caps at 3 weaknesses even when more are listed', async () => {
    const caller: ModelCaller = async () => ({
      text: [
        'ASSUMPTION HIGH: a',
        'EVIDENCE MEDIUM: b',
        'LOGIC LOW: c',
        'ASSUMPTION LOW: d',
        'EVIDENCE HIGH: e',
      ].join('\n'),
      tokens: 5,
    });
    const r = await runChallenge({
      question: 'x',
      original_answer: 'y',
      challenge_seat: judge,
      caller,
    });
    expect(r.weaknesses.length).toBe(3);
  });

  it('uses exactly 1 call', async () => {
    const caller: ModelCaller = async () => ({ text: '', tokens: 0 });
    const r = await runChallenge({
      question: 'x',
      original_answer: 'y',
      challenge_seat: judge,
      caller,
    });
    expect(r.calls_used).toBe(1);
  });
});

describe('change my mind — parse response', () => {
  it('extracts the four sections', async () => {
    const caller: ModelCaller = async () => ({
      text: [
        'COUNTER: The premises are wrong because X.',
        'SURVIVED: The conclusion still holds under Y.',
        'FAILED: The supporting evidence for Z.',
        'UNCERTAIN: Whether W will repeat.',
      ].join('\n'),
      tokens: 30,
    });
    const r = await runChangeMyMind({
      question: 'x',
      current_position: 'y',
      challenger_seat: judge,
      caller,
    });
    expect(r.strongest_counter).toBe('The premises are wrong because X.');
    expect(r.what_survived).toBe('The conclusion still holds under Y.');
    expect(r.what_failed).toBe('The supporting evidence for Z.');
    expect(r.what_remains_uncertain).toBe('Whether W will repeat.');
    expect(r.calls_used).toBe(1);
  });

  it('handles short single-section reply gracefully', async () => {
    const caller: ModelCaller = async () => ({
      text: 'COUNTER: Just one paragraph.',
      tokens: 3,
    });
    const r = await runChangeMyMind({
      question: 'x',
      current_position: 'y',
      challenger_seat: judge,
      caller,
    });
    expect(r.strongest_counter).toBe('Just one paragraph.');
    expect(r.what_survived).toBe('');
  });
});
// === FILE END ===