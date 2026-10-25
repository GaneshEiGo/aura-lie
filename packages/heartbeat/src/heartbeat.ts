// packages/heartbeat/src/heartbeat.ts
// The Heartbeat Engine. PRD 10.4 + 10.5 + 5.18.
//
// Order of checks (matches PRD 10.4 "Worker: kill-switch check FIRST"):
//   1. Kill switch
//   2. Level 0 (silent)
//   3. Daily cap
//   4. Per-topic cooldown
//   5. Quiet hours
//   6. Send score threshold
//
// If ANY of these returns "blocked", the caller MUST NOT make a model call.
// Only a decision with `compose: true` may trigger a compose step. This
// enforces PRD 10.4: "A heartbeat tick that does not pass the send score
// costs zero provider calls."

import type {
  ComposeDecision,
  HeartbeatOptions,
  HeartbeatState,
  Trigger,
} from './types.js';
import { LEVEL_CAPS } from './types.js';
import { computeSendScore } from './score.js';
import { isWithinQuietHours } from './quiet.js';
import { rollover } from './rollover.js';

export function shouldCompose(
  trigger: Trigger,
  rawState: HeartbeatState,
  options: HeartbeatOptions = {},
): ComposeDecision {
  const now = (options.clock ?? { now: () => Date.now() }).now();
  const state = rollover(rawState, now);

  // Score is always computed so the "Why did I get this?" card can show it
  // even when composition is blocked for another reason.
  const score = computeSendScore(trigger, state);

  // 1. Kill switch — PRD 10.4: "A flag in D1 checked first on every tick."
  if (state.killSwitchActive) {
    return {
      compose: false,
      reason: 'Autonomy paused',
      score,
      blockedBy: 'kill_switch',
    };
  }

  // 2. Level 0 — silent.
  if (state.level === 0) {
    return {
      compose: false,
      reason: 'Autonomy Level 0 (silent)',
      score,
      blockedBy: 'level_silent',
    };
  }

  // 3. Daily cap — PRD 10.2: caps of 2 / 4 / 6, hard cap 6.
  const perLevelCap = LEVEL_CAPS[state.level];
  const globalCap = options.globalHardCap ?? 6;
  const effectiveCap = Math.min(perLevelCap, globalCap);
  if (state.notesToday >= effectiveCap) {
    return {
      compose: false,
      reason: `Daily cap reached (${state.notesToday}/${effectiveCap})`,
      score,
      blockedBy: 'cap_reached',
    };
  }

  // 4. Per-topic cooldown — PRD 10.5: "per-topic dedup windows".
  const cooldownMs = (options.cooldownHours ?? 24) * 60 * 60 * 1000;
  const lastSameTopic = state.recentNotes
    .filter((n) => n.topic === trigger.topic)
    .sort((a, b) => b.at - a.at)[0];
  if (lastSameTopic && now - lastSameTopic.at < cooldownMs) {
    const hoursAgo = ((now - lastSameTopic.at) / 3_600_000).toFixed(1);
    return {
      compose: false,
      reason: `Topic "${trigger.topic}" was noted ${hoursAgo}h ago (cooldown ${options.cooldownHours ?? 24}h)`,
      score,
      blockedBy: 'cooldown',
    };
  }

  // 5. Quiet hours.
  const quiet = isWithinQuietHours(
    now,
    state,
    trigger,
    options.quietStartHour ?? 23,
    options.quietEndHour ?? 8,
  );
  if (quiet.blocked) {
    return {
      compose: false,
      reason: quiet.reason,
      score,
      blockedBy: 'quiet_hours',
    };
  }

  // 6. Send score threshold.
  if (!score.passes) {
    return {
      compose: false,
      reason: `Send score ${score.raw.toFixed(3)} below threshold ${score.threshold.toFixed(2)}`,
      score,
      blockedBy: 'score',
    };
  }

  // Passed all gates. Return the PRD 10.6 "why you're seeing this" reason.
  return {
    compose: true,
    reason: trigger.reason,
    score,
  };
}