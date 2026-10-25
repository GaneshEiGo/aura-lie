// === FILE START ===
// packages/council-engine/src/real.ts
// PRD §7.9 · §5.16 · FR-COUNCIL-01 · FR-COUNCIL-02 · D-11.
//
// Real council: ≥ 2 model families, one seat per independent mind. Judge
// must belong to a family that differs from every seat's family. Dissent is
// never smoothed over — it is the point of the exercise.
//
// Anti-theatre rule (§7.9): if the synthesis is identical (after
// normalisation) to the majority answer, the whole run is flagged
// `no_op: true` so the caller can hide it.
//
// Call budget (§7.9): the whole run uses at most `max_calls` (default 12)
// total calls, one per seat plus one judge call.

export interface CouncilSeat {
  /** e.g. 'yuki', 'kaito', 'rin'. */
  persona: string;
  /** Lowercase family id: 'groq', 'gemini', 'cerebras', 'workers-ai', ... */
  model_family: string;
  /** Provider id, kept for trace display only. */
  provider: string;
}

export interface ModelCallRequest {
  seat: CouncilSeat;
  prompt: string;
}

export interface ModelCallResponse {
  text: string;
  tokens: number;
}

export type ModelCaller = (req: ModelCallRequest) => Promise<ModelCallResponse>;

export interface RealCouncilInput {
  question: string;
  seats: CouncilSeat[];
  judge_seat: CouncilSeat;
  caller: ModelCaller;
  max_calls?: number;
}

export interface SeatResult {
  seat: CouncilSeat;
  answer: string;
  tokens: number;
}

export interface CouncilVerdict {
  proposal: string;
  synthesis: string;
  dissent_seat_index: number | null;
  dissent_reason: string | null;
  evidence: string[];
  counter_evidence: string[];
}

export type CouncilLabel =
  | { kind: 'real'; model_families: string[] }
  | { kind: 'simulated'; label: 'Simulated dissent (single model)' };

export interface RealCouncilResult {
  label: CouncilLabel;
  seats: SeatResult[];
  verdict: CouncilVerdict;
  calls_used: number;
  no_op: boolean;
}

export class CouncilError extends Error {
  readonly kind = 'CouncilError';
  constructor(message: string) {
    super(message);
    this.name = 'CouncilError';
  }
}

const DEFAULT_MAX_CALLS = 12;

export async function runRealCouncil(
  input: RealCouncilInput,
): Promise<RealCouncilResult> {
  const maxCalls = input.max_calls ?? DEFAULT_MAX_CALLS;

  if (input.seats.length < 2) {
    throw new CouncilError('Real council requires at least 2 seats');
  }
  const families = new Set(input.seats.map((s) => s.model_family));
  if (families.size < 2) {
    throw new CouncilError('Real council requires at least 2 distinct model families');
  }
  if (families.has(input.judge_seat.model_family)) {
    throw new CouncilError('Judge must be a different family from every seat');
  }
  if (input.seats.length + 1 > maxCalls) {
    throw new CouncilError(
      `Council would exceed call budget: ${input.seats.length + 1} > ${maxCalls}`,
    );
  }

  const seatResults: SeatResult[] = [];
  for (const seat of input.seats) {
    const resp = await input.caller({ seat, prompt: input.question });
    seatResults.push({ seat, answer: resp.text, tokens: resp.tokens });
  }

  const answerGroups = new Map<string, number[]>();
  for (let i = 0; i < seatResults.length; i++) {
    const key = normalise(seatResults[i]!.answer);
    const arr = answerGroups.get(key) ?? [];
    arr.push(i);
    answerGroups.set(key, arr);
  }
  let majorityKey = '';
  let majoritySize = 0;
  for (const [key, arr] of answerGroups) {
    if (arr.length > majoritySize) {
      majoritySize = arr.length;
      majorityKey = key;
    }
  }
  let dissentingSeatIndex: number | null = null;
  for (const [key, arr] of answerGroups) {
    if (key !== majorityKey && arr.length > 0) {
      dissentingSeatIndex = arr[0]!;
      break;
    }
  }

  const judgePrompt = buildJudgePrompt(input.question, seatResults);
  const judgeResp = await input.caller({ seat: input.judge_seat, prompt: judgePrompt });
  const synthesis = judgeResp.text;
  const noOp = normalise(synthesis) === majorityKey;

  return {
    label: { kind: 'real', model_families: Array.from(families) },
    seats: seatResults,
    verdict: {
      proposal: seatResults[0]!.answer,
      synthesis,
      dissent_seat_index: dissentingSeatIndex,
      dissent_reason:
        dissentingSeatIndex !== null ? 'answer differs from the majority' : null,
      evidence: [],
      counter_evidence: [],
    },
    calls_used: seatResults.length + 1,
    no_op: noOp,
  };
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildJudgePrompt(question: string, seats: SeatResult[]): string {
  const lines = [`Question: ${question}`, '', 'Answers:'];
  for (const r of seats) {
    lines.push(`[${r.seat.persona}] ${r.answer}`);
  }
  lines.push(
    '',
    'Synthesise the most evidence-grounded answer.',
    'Prefer evidence over popularity.',
    'If the answers agree, restate them briefly.',
    'If they disagree, name the disagreement and the strongest evidence for each side.',
  );
  return lines.join('\n');
}
// === FILE END ===