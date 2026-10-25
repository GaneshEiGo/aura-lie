// === FILE START ===
// packages/agents/src/scenarios-v2.ts
// PRD §15.5 · T-13.
//
// The five AGI-shaped capability scenarios from PRD §15.5. They are the
// acceptance-test contracts for W7:
//
//   1. unfamiliar-goal   Research a technical problem you did not specify
//                        fully, then ask exactly one useful question.
//   2. error-recovery    Recover from a failed search, a rate limit and a
//                        contradictory source without losing state.
//   3. next-day-resume   Resume the next day from project state with no
//                        pasted context.
//   4. irreversible-stop Stop and ask when the next step is irreversible.
//   5. stranger-replay   A stranger can follow the run from its trace alone.
//
// These are declarative: the id, the title, and the sequence of event *kinds*
// a successful run must produce. `checkScenario` runs the ordered-subsequence
// match so a run that emits extra events between the required ones still
// passes — this matches how real missions interleave progress, quota notices,
// and other non-required signals.
//
// Zero external imports.

export type ScenarioId =
  | 'unfamiliar-goal'
  | 'error-recovery'
  | 'next-day-resume'
  | 'irreversible-stop'
  | 'stranger-replay';

export interface CapabilityScenario {
  id: ScenarioId;
  title: string;
  description: string;
  /** Event kinds that MUST appear, in this order, in a successful run. */
  expectedEvents: readonly string[];
}

export const SCENARIOS: readonly CapabilityScenario[] = Object.freeze([
  Object.freeze({
    id: 'unfamiliar-goal' as ScenarioId,
    title: 'Unfamiliar goal — ask one useful question',
    description:
      'Research a technical problem you did not specify fully, then ask exactly one useful question before continuing.',
    expectedEvents: Object.freeze([
      'plan',
      'search',
      'ask-user',
      'search',
      'synthesise',
    ]),
  }),
  Object.freeze({
    id: 'error-recovery' as ScenarioId,
    title: 'Error recovery — no state lost',
    description:
      'Recover from a failed search, a rate limit and a contradictory source without losing state.',
    expectedEvents: Object.freeze([
      'plan',
      'search',
      'error',
      'retry',
      'search',
      'conflict',
      'resolve',
    ]),
  }),
  Object.freeze({
    id: 'next-day-resume' as ScenarioId,
    title: 'Next-day resume — no pasted context',
    description:
      'Resume the next day from project state with no pasted context.',
    expectedEvents: Object.freeze(['load-state', 'resume', 'execute']),
  }),
  Object.freeze({
    id: 'irreversible-stop' as ScenarioId,
    title: 'Irreversible step — stop and ask',
    description: 'Stop and ask when the next step is irreversible.',
    expectedEvents: Object.freeze([
      'plan',
      'execute',
      'permission-required',
    ]),
  }),
  Object.freeze({
    id: 'stranger-replay' as ScenarioId,
    title: 'Replay readable by a stranger',
    description: 'A stranger can follow the run from its trace alone.',
    expectedEvents: Object.freeze([
      'plan',
      'search',
      'verify',
      'synthesise',
      'done',
    ]),
  }),
]);

export function getScenario(id: ScenarioId): CapabilityScenario | null {
  for (const s of SCENARIOS) if (s.id === id) return s;
  return null;
}

export type ScenarioCheckResult =
  | { ok: true; matched: readonly string[] }
  | {
      ok: false;
      matched: readonly string[];
      missing: readonly string[];
      firstMissingAt: number;
    };

/**
 * Ordered-subsequence match. Walks the expected events and the recorded event
 * kinds together. A recorded event that does not match the current expected
 * one is skipped (it is a real event, just not one this scenario requires).
 * The scenario passes iff every expected event is found in order.
 */
export function checkScenario(
  scenario: CapabilityScenario,
  recordedEventKinds: readonly string[],
): ScenarioCheckResult {
  const matched: string[] = [];
  let cursor = 0;

  for (const expected of scenario.expectedEvents) {
    let found = false;
    while (cursor < recordedEventKinds.length) {
      const current = recordedEventKinds[cursor];
      cursor++;
      if (current === expected) {
        matched.push(expected);
        found = true;
        break;
      }
    }
    if (!found) {
      return {
        ok: false,
        matched,
        missing: scenario.expectedEvents.slice(matched.length),
        firstMissingAt: matched.length,
      };
    }
  }

  return { ok: true, matched };
}
// === FILE END ===