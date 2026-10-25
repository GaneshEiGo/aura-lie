// === FILE START ===
// packages/council-engine/src/synthesis.ts
// PRD §7.9 · §7.14 · §8.7 · §10.10 · FR-COUNCIL-02 · FR-TRUTH-16.
//
// Contents:
//   · finalizeCouncilRun — PRD §7.9 anti-theatre rule; hides a no-op council.
//                         reason contains "<N> dissent logged" when dissent
//                         exists, "logged as a no-op" otherwise.
//   · renderSynthesis   — PRD §7.9 evidence-first order. ALWAYS emits all 7
//                         headers (fixed order), showing "- (none)" for empty
//                         sections so completeness is visible. Reads
//                         snake_case AND camelCase aliases.
//                         Agreement: accepts a number in [0,1] as a FRACTION
//                         (PRD §8.7 canonical form) and renders "<pct>%";
//                         accepts a number >1 as ALREADY a percent; accepts
//                         "75%", "0.75" and "75" strings with the same rules;
//                         passes free text through unchanged.
//   · synthesiseCouncil — judge-driven synthesis (Section 93, kept for compat).
//
// Interface contract enforced by pre-existing council-engine.test.ts:
//   · FinalizeCouncilRunResult has isNoOp, hiddenFromUser, dissent, reason.
//   · reason matches /logged as a no-op/i          → no-op path
//   · reason matches /<N> dissent logged/          → shown-with-dissent path
//   · renderSynthesis emits Proposal, Evidence, Counter-evidence,
//     Source quality, Contradictions, Agreement, Synthesis in that order.
//   · Fractional agreement 0.75   → "Agreement: 75%"
//   · Percent integer     75      → "Agreement: 75%"
//   · Percent string     "75%"    → "Agreement: 75%"

import type { CouncilSeat, ModelCaller, SeatResult } from './real.js';

// =============================================================================
// 1. Verdict shape
// =============================================================================

export interface Verdict {
  proposal: string;
  evidence: string[];
  counter_evidence: string[];
  source_quality?: string[];
  contradictions?: string[];
  /**
   * Agreement — see pickAgreement() for the full normalisation rules.
   * Numeric input is interpreted per PRD §8.7:
   *   · a value in [0, 1] is a FRACTION       (0.75 → "75%")
   *   · a value > 1 is ALREADY a percentage   (75   → "75%")
   */
  agreement?: string | number;
  synthesis: string;
}

// =============================================================================
// 2. finalizeCouncilRun — PRD §7.9 anti-theatre rule
// =============================================================================

export type Dissent = Record<string, unknown>;

export interface FinalizeCouncilRunInput {
  claimId: string;
  labelling: unknown;
  verdict: Verdict;
  dissent?: Dissent[];
  changes?: {
    new_risk?: boolean;
    changed_claim?: boolean;
    better_answer?: boolean;
  };
  original_answer?: string;
  baseline?: Verdict;
}

export interface FinalizeCouncilRunResult {
  claimId: string;
  labelling: unknown;
  verdict: Verdict;
  dissent: Dissent[];
  isNoOp: boolean;
  hiddenFromUser: boolean;
  no_op: boolean;
  hidden: boolean;
  reason: string;
}

export function finalizeCouncilRun(
  input: FinalizeCouncilRunInput,
): FinalizeCouncilRunResult {
  const dissent = input.dissent ?? [];
  const c = input.changes ?? {};
  const hasDissent = dissent.length > 0;
  const explicitChange = !!(c.new_risk || c.changed_claim || c.better_answer);

  if (hasDissent || explicitChange) {
    return shown(input, dissent);
  }

  if (
    typeof input.original_answer === 'string' &&
    normalise(input.verdict.synthesis) !== normalise(input.original_answer)
  ) {
    return shown(input, dissent);
  }

  if (
    input.baseline &&
    JSON.stringify(input.baseline) !== JSON.stringify(input.verdict)
  ) {
    return shown(input, dissent);
  }

  return {
    claimId: input.claimId,
    labelling: input.labelling,
    verdict: input.verdict,
    dissent,
    isNoOp: true,
    hiddenFromUser: true,
    no_op: true,
    hidden: true,
    reason: 'Council changed nothing; logged as a no-op and hidden',
  };
}

function shown(
  input: FinalizeCouncilRunInput,
  dissent: Dissent[],
): FinalizeCouncilRunResult {
  const reason =
    dissent.length > 0
      ? `${dissent.length} dissent${dissent.length === 1 ? '' : 's'} logged`
      : 'Council changed the answer';
  return {
    claimId: input.claimId,
    labelling: input.labelling,
    verdict: input.verdict,
    dissent,
    isNoOp: false,
    hiddenFromUser: false,
    no_op: false,
    hidden: false,
    reason,
  };
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// =============================================================================
// 3. renderSynthesis — PRD §7.9 evidence-first order, ALL headers always shown
// =============================================================================

export function renderSynthesis(v: Verdict): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = v as any;

  const proposal = pickString(raw.proposal) ?? '-';
  const evidence = pickArray(raw.evidence);
  const counterEvidence = pickArray(raw.counter_evidence, raw.counterEvidence);
  const sourceQuality = pickArray(raw.source_quality, raw.sourceQuality);
  const contradictions = pickArray(raw.contradictions);
  const agreement = pickAgreement(raw.agreement);
  const synthesis = pickString(raw.synthesis) ?? '-';

  return [
    `Proposal: ${proposal}`,
    renderList('Evidence', evidence),
    renderList('Counter-evidence', counterEvidence),
    renderList('Source quality', sourceQuality),
    renderList('Contradictions', contradictions),
    `Agreement: ${agreement}`,
    `Synthesis: ${synthesis}`,
  ].join('\n\n');
}

function pickString(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

function pickArray(...xs: unknown[]): string[] {
  for (const x of xs) {
    if (Array.isArray(x)) {
      return x.filter((i): i is string => typeof i === 'string');
    }
  }
  return [];
}

function renderList(title: string, items: string[]): string {
  if (items.length === 0) return `${title}:\n- (none)`;
  return `${title}:\n${items.map((i) => `- ${i}`).join('\n')}`;
}

/**
 * Normalise `agreement` for display. Rules (PRD §7.9 + §8.7):
 *   · number in [0, 1] → fraction, rendered "<n*100>%"
 *   · number outside  [0, 1] → already a percent, rendered "<n>%"
 *   · string containing "%" → as-is
 *   · numeric string → same fraction/percent split as above
 *   · non-numeric string → as-is
 *   · undefined / empty / non-finite → "-"
 */
function pickAgreement(x: unknown): string {
  if (typeof x === 'number') {
    return formatAgreementNumber(x);
  }
  if (typeof x === 'string') {
    const t = x.trim();
    if (t.length === 0) return '-';
    if (t.includes('%')) return t;
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      return formatAgreementNumber(parseFloat(t));
    }
    return t;
  }
  return '-';
}

function formatAgreementNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 0 && n <= 1) {
    // Fraction (PRD §8.7): 0.75 → "75%"; 0 → "0%"; 1 → "100%".
    const pct = Math.round(n * 1000) / 10;
    return `${pct}%`;
  }
  // Already a percent (fixture wrote 75, 50, 100, etc.).
  return `${n}%`;
}

// =============================================================================
// 4. synthesiseCouncil — judge-driven synthesis (Section 93, kept for compat)
// =============================================================================

export interface SynthesisInput {
  question: string;
  seats: SeatResult[];
  judge_seat: CouncilSeat;
  caller: ModelCaller;
}

export interface SynthesisResult {
  synthesis: string;
  proposal: string;
  evidence: string[];
  counter_evidence: string[];
  dissenting_seat_index: number | null;
  calls_used: number;
}

export async function synthesiseCouncil(
  input: SynthesisInput,
): Promise<SynthesisResult> {
  if (input.seats.length === 0) {
    throw new Error('synthesiseCouncil: seats is empty');
  }
  if (
    input.seats.some((s) => s.seat.model_family === input.judge_seat.model_family)
  ) {
    throw new Error('Judge family must differ from every seat');
  }

  const groups = new Map<string, number[]>();
  for (let i = 0; i < input.seats.length; i++) {
    const key = normalise(input.seats[i]!.answer);
    const arr = groups.get(key) ?? [];
    arr.push(i);
    groups.set(key, arr);
  }
  let majorityKey = '';
  let majoritySize = 0;
  for (const [key, arr] of groups) {
    if (arr.length > majoritySize) {
      majoritySize = arr.length;
      majorityKey = key;
    }
  }
  let dissentingSeatIndex: number | null = null;
  for (const [key, arr] of groups) {
    if (key !== majorityKey && arr.length > 0) {
      dissentingSeatIndex = arr[0]!;
      break;
    }
  }

  const prompt = [
    `Question: ${input.question}`,
    '',
    'Answers:',
    ...input.seats.map((s, i) => `[${i}] ${s.seat.persona}: ${s.answer}`),
    '',
    'Synthesise the most evidence-grounded answer.',
    'Format:',
    'SYNTHESIS: <answer>',
    'EVIDENCE: <bullet points, one per line>',
    'COUNTER: <disagreements, one per line>',
  ].join('\n');

  const resp = await input.caller({ seat: input.judge_seat, prompt });
  return {
    synthesis: extractSection(resp.text, 'SYNTHESIS') ?? resp.text,
    proposal: input.seats[0]!.answer,
    evidence: splitLines(extractSection(resp.text, 'EVIDENCE') ?? ''),
    counter_evidence: splitLines(extractSection(resp.text, 'COUNTER') ?? ''),
    dissenting_seat_index: dissentingSeatIndex,
    calls_used: 1,
  };
}

function extractSection(text: string, key: string): string | null {
  const re = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, 'i');
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function splitLines(s: string): string[] {
  return s
    .split(/\n+/)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}
// === FILE END ===