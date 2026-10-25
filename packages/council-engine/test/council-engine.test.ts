// packages/council-engine/test/council-engine.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildSeats,
  checkCouncilBudget,
  shouldAutoCouncil,
  finalizeCouncilRun,
  renderSynthesis,
  COUNCIL_MAX_CALLS,
  COUNCIL_CONFIRM_THRESHOLD,
  AUTO_COUNCIL_SCORE_THRESHOLD,
} from '../src/index.js';
import type {
  AvailableFamily,
  CouncilVerdict,
  SeatRequest,
} from '../src/types.js';

const NUMBERS: SeatRequest = { role: 'numbers', persona: 'Yuki', family: 'groq', modelId: 'llama-3.3-70b' };
const OBJECTIONS: SeatRequest = { role: 'objections', persona: 'Kaito', family: 'gemini', modelId: 'gemini-2-flash' };
const FACTS: SeatRequest = { role: 'facts', persona: 'Nova', family: 'cerebras', modelId: 'llama-3.1-8b' };

function verdict(overrides: Partial<CouncilVerdict> = {}): CouncilVerdict {
  return {
    proposal: 'Do it',
    evidence: ['runway 14 months'],
    counterEvidence: ['assumes stable income'],
    sourceQuality: 'primary',
    contradictions: [],
    agreement: 0.75,
    synthesis: 'Do it, with a buffer.',
    newRisk: false,
    changedClaim: false,
    betterAnswer: false,
    ...overrides,
  };
}

describe('Council Engine (PRD 7.9, FR-COUNCIL-01..06)', () => {
  // ---- Seat assembly: real -------------------------------------------
  it('assembles a real council when ≥2 families are available', () => {
    const available: AvailableFamily[] = [
      { family: 'groq', modelId: 'llama-3.3-70b' },
      { family: 'gemini', modelId: 'gemini-2-flash' },
    ];
    const assembly = buildSeats([NUMBERS, OBJECTIONS], available);
    expect(assembly.labelling).toBe('real');
    expect(assembly.seats.length).toBe(2);
    const families = new Set(assembly.seats.map((s) => s.family));
    expect(families.size).toBeGreaterThanOrEqual(2);
    expect(assembly.label).toMatch(/^Council: /);
    expect(assembly.label).not.toMatch(/Simulated/);
  });

  // ---- Seat assembly: simulated --------------------------------------
  it('marks the council simulated when only one family is available', () => {
    const available: AvailableFamily[] = [
      { family: 'groq', modelId: 'llama-3.3-70b' },
    ];
    const assembly = buildSeats([NUMBERS, OBJECTIONS, FACTS], available);
    expect(assembly.labelling).toBe('simulated');
    expect(assembly.seats.length).toBe(3);
    expect(new Set(assembly.seats.map((s) => s.family)).size).toBe(1);
    expect(assembly.label).toBe('Simulated dissent (single model)');
  });

  it('marks the council simulated when available families is empty', () => {
    const assembly = buildSeats([NUMBERS], []);
    expect(assembly.labelling).toBe('simulated');
    expect(assembly.seats.length).toBe(0);
    expect(assembly.label).toBe('Simulated dissent (single model)');
  });

  // ---- Budget: normal case -------------------------------------------
  it('budget check passes when quota is plentiful', () => {
    const check = checkCouncilBudget({
      estimatedCalls: 12,
      totalPerDay: 900,
      remainingPerDay: 800,
    });
    expect(check.affordable).toBe(true);
    expect(check.requiresConfirm).toBe(false);
  });

  // ---- Budget: < 40% quota requires confirm (FR-COUNCIL-06) ----------
  it('requires confirmation when quota drops under 40%', () => {
    const check = checkCouncilBudget({
      estimatedCalls: 12,
      totalPerDay: 900,
      remainingPerDay: 300, // 300 / 900 ≈ 33% < 40%
    });
    expect(check.affordable).toBe(true);
    expect(check.requiresConfirm).toBe(true);
    expect(check.reason).toMatch(/quota is low/i);
  });

  // ---- Budget: not enough remaining --------------------------------
  it('reports unaffordable when remaining < estimated', () => {
    const check = checkCouncilBudget({
      estimatedCalls: 12,
      totalPerDay: 900,
      remainingPerDay: 5,
    });
    expect(check.affordable).toBe(false);
    expect(check.estimatedCalls).toBe(12);
  });

  // ---- Budget: estimatedCalls clamped to PRD cap of 12 --------------
  it('clamps the estimate to the PRD cap of 12', () => {
    const check = checkCouncilBudget({
      estimatedCalls: 100,
      totalPerDay: 900,
      remainingPerDay: 800,
    });
    expect(check.estimatedCalls).toBe(COUNCIL_MAX_CALLS);
  });

  // ---- Auto-council: triggered --------------------------------------
  it('auto-triggers when a central claim scores under 70', () => {
    const decision = shouldAutoCouncil({
      claimId: 'c1',
      predictedFactScore: 48,
      importance: 'central',
    });
    expect(decision.shouldAuto).toBe(true);
    expect(decision.reason).toMatch(/auto-council triggered/i);
  });

  it('auto-triggers on a numeric critical importance', () => {
    const decision = shouldAutoCouncil({
      claimId: 'c2',
      predictedFactScore: 60,
      importance: 0.9,
    });
    expect(decision.shouldAuto).toBe(true);
  });

  it('does not auto-trigger for non-critical claims even with a low score', () => {
    const decision = shouldAutoCouncil({
      claimId: 'c3',
      predictedFactScore: 20,
      importance: 'supporting',
    });
    expect(decision.shouldAuto).toBe(false);
    expect(decision.reason).toMatch(/not critical/i);
  });

  it('does not auto-trigger for a high-scoring central claim', () => {
    const decision = shouldAutoCouncil({
      claimId: 'c4',
      predictedFactScore: 85,
      importance: 'central',
    });
    expect(decision.shouldAuto).toBe(false);
    expect(decision.reason).toMatch(/no auto-council needed/i);
  });

  // ---- Anti-theatre rule (PRD 7.9) -----------------------------------
  it('marks a no-op council as hidden when nothing changed', () => {
    const available: AvailableFamily[] = [
      { family: 'groq', modelId: 'llama-3.3-70b' },
      { family: 'gemini', modelId: 'gemini-2-flash' },
    ];
    const assembly = buildSeats([NUMBERS, OBJECTIONS], available);
    const result = finalizeCouncilRun({
      claimId: 'c1',
      labelling: assembly.labelling,
      label: assembly.label,
      seats: assembly.seats,
      verdict: verdict({
        newRisk: false,
        changedClaim: false,
        betterAnswer: false,
      }),
      dissent: [],
    });
    expect(result.isNoOp).toBe(true);
    expect(result.hiddenFromUser).toBe(true);
    expect(result.reason).toMatch(/logged as a no-op/i);
  });

  it('shows the council when a new risk is raised', () => {
    const available: AvailableFamily[] = [
      { family: 'groq', modelId: 'llama-3.3-70b' },
      { family: 'gemini', modelId: 'gemini-2-flash' },
    ];
    const assembly = buildSeats([NUMBERS, OBJECTIONS], available);
    const result = finalizeCouncilRun({
      claimId: 'c1',
      labelling: assembly.labelling,
      label: assembly.label,
      seats: assembly.seats,
      verdict: verdict({ newRisk: true }),
      dissent: [
        { role: 'objections', persona: 'Kaito', reason: 'Runway assumes stable income.' },
      ],
    });
    expect(result.isNoOp).toBe(false);
    expect(result.hiddenFromUser).toBe(false);
    expect(result.dissent.length).toBe(1);
    expect(result.reason).toMatch(/1 dissent logged/);
  });

  // ---- Evidence-ranked synthesis order ------------------------------
  it('renders synthesis in the PRD evidence-first order', () => {
    const text = renderSynthesis(
      verdict({
        proposal: 'Do it',
        evidence: ['runway 14 months', '3 independent sources'],
        counterEvidence: ['stable income assumed'],
        sourceQuality: 'primary',
        contradictions: ['year mismatch between annual and quarterly'],
        agreement: 0.75,
        synthesis: 'Do it, with a buffer.',
      }),
    );
    const idx = (s: string) => text.indexOf(s);
    expect(idx('Proposal')).toBeLessThan(idx('Evidence'));
    expect(idx('Evidence')).toBeLessThan(idx('Counter-evidence'));
    expect(idx('Counter-evidence')).toBeLessThan(idx('Source quality'));
    expect(idx('Source quality')).toBeLessThan(idx('Contradictions'));
    expect(idx('Contradictions')).toBeLessThan(idx('Agreement'));
    expect(idx('Agreement')).toBeLessThan(idx('Synthesis'));
    expect(text).toContain('Agreement: 75%');
  });

  // ---- Thresholds and constants are PRD-pinned ----------------------
  it('uses the PRD threshold constants', () => {
    expect(COUNCIL_MAX_CALLS).toBe(12);
    expect(COUNCIL_CONFIRM_THRESHOLD).toBe(0.4);
    expect(AUTO_COUNCIL_SCORE_THRESHOLD).toBe(70);
  });

  // ---- Labelled as real when available families reached 2 ----------
  it('a two-family assembly is always labelled real, even if requests share a family', () => {
    const requested: SeatRequest[] = [
      { role: 'numbers', persona: 'Yuki', family: 'groq', modelId: 'a' },
      { role: 'objections', persona: 'Kaito', family: 'groq', modelId: 'a' },
    ];
    const available: AvailableFamily[] = [
      { family: 'groq', modelId: 'llama-3.3-70b' },
      { family: 'gemini', modelId: 'gemini-2-flash' },
    ];
    const assembly = buildSeats(requested, available);
    expect(assembly.labelling).toBe('real');
    const families = new Set(assembly.seats.map((s) => s.family));
    expect(families.size).toBeGreaterThanOrEqual(2);
  });
});