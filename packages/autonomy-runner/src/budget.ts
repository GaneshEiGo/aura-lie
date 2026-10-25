// packages/autonomy-runner/src/budget.ts
// PRD 10.2: "Separate daily 'energy' budgets limit background model calls:
// Level 1 about 10, Level 2 about 40, Level 3 about 60. You can see 'energy
// left' in the Autonomy page."

import type { AutonomyLevel } from './types.js';
import { ENERGY_BUDGET } from './types.js';

export interface EnergyState {
  level: AutonomyLevel;
  used: number;
  at: number;
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function rolloverEnergy(state: EnergyState, now: number): EnergyState {
  const today = startOfLocalDay(now);
  if (state.at === today) return state;
  return { ...state, used: 0, at: today };
}

export function canAfford(state: EnergyState, calls: number): boolean {
  return state.used + calls <= ENERGY_BUDGET[state.level];
}

export function consume(state: EnergyState, calls: number): EnergyState {
  return { ...state, used: state.used + calls };
}

export function remaining(state: EnergyState): number {
  return Math.max(0, ENERGY_BUDGET[state.level] - state.used);
}