// === FILE START ===
// packages/council-engine/src/challenge.ts
// PRD §7.9 · FR-TRUTH-15.
//
// Challenge (red team): the assistant attacks its own answer, listing at
// most 3 weaknesses ranked by severity, then names the repair.
//
// Change my mind: builds the strongest counter-argument, then reports
// what survived, what failed, what remains uncertain. Both are single-call.

import type { CouncilSeat, ModelCaller } from './real.js';

// ---------- Challenge ----------

export type WeaknessKind = 'assumption' | 'evidence' | 'logic';
export type Severity = 'high' | 'medium' | 'low';

export interface Weakness {
  kind: WeaknessKind;
  severity: Severity;
  text: string;
}

export interface ChallengeInput {
  original_answer: string;
  question: string;
  challenge_seat: CouncilSeat;
  caller: ModelCaller;
}

export interface ChallengeResult {
  weaknesses: Weakness[];
  repair_hint: string;
  calls_used: number;
}

export async function runChallenge(
  input: ChallengeInput,
): Promise<ChallengeResult> {
  const prompt = [
    `Question: ${input.question}`,
    `Original answer: ${input.original_answer}`,
    '',
    'Attack this answer. List at most 3 weaknesses, one per line.',
    'Format:',
    'ASSUMPTION <HIGH|MEDIUM|LOW>: <text>',
    'EVIDENCE <HIGH|MEDIUM|LOW>: <text>',
    'LOGIC <HIGH|MEDIUM|LOW>: <text>',
    'REPAIR: <one sentence>',
  ].join('\n');
  const resp = await input.caller({ seat: input.challenge_seat, prompt });
  return {
    weaknesses: parseWeaknesses(resp.text),
    repair_hint: extractRepair(resp.text) ?? '',
    calls_used: 1,
  };
}

function parseWeaknesses(text: string): Weakness[] {
  const out: Weakness[] = [];
  const re =
    /(ASSUMPTION|EVIDENCE|LOGIC)\s+(HIGH|MEDIUM|LOW)\s*[:\-]?\s*(.+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < 3) {
    out.push({
      kind: m[1]!.toLowerCase() as WeaknessKind,
      severity: m[2]!.toLowerCase() as Severity,
      text: m[3]!.trim(),
    });
  }
  return out;
}

function extractRepair(text: string): string | null {
  const m = text.match(/REPAIR:\s*(.+)$/im);
  return m && m[1] ? m[1].trim() : null;
}

// ---------- Change my mind ----------

export interface ChangeMyMindInput {
  question: string;
  current_position: string;
  challenger_seat: CouncilSeat;
  caller: ModelCaller;
}

export interface ChangeMyMindResult {
  strongest_counter: string;
  what_survived: string;
  what_failed: string;
  what_remains_uncertain: string;
  calls_used: number;
}

export async function runChangeMyMind(
  input: ChangeMyMindInput,
): Promise<ChangeMyMindResult> {
  const prompt = [
    `Question: ${input.question}`,
    `Current position: ${input.current_position}`,
    '',
    'Build the strongest counter-argument you can.',
    'Then report what survived, what failed, and what remains uncertain.',
    'Format:',
    'COUNTER: <one paragraph>',
    'SURVIVED: <one sentence>',
    'FAILED: <one sentence>',
    'UNCERTAIN: <one sentence>',
  ].join('\n');
  const resp = await input.caller({ seat: input.challenger_seat, prompt });
  return {
    strongest_counter: extractSection(resp.text, 'COUNTER') ?? resp.text,
    what_survived: extractSection(resp.text, 'SURVIVED') ?? '',
    what_failed: extractSection(resp.text, 'FAILED') ?? '',
    what_remains_uncertain: extractSection(resp.text, 'UNCERTAIN') ?? '',
    calls_used: 1,
  };
}

function extractSection(text: string, key: string): string | null {
  const re = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, 'i');
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : null;
}
// === FILE END ===