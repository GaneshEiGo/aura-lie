// === FILE START ===
// packages/council-engine/src/simulated.ts
// PRD §7.9 · FR-COUNCIL-01 · D-11.
//
// Simulated council: one model plays several personas in a single call.
// The label is fixed by PRD: "Simulated dissent (single model)". This is
// useful for brainstorming and MUST NOT be presented as independent
// agreement.
//
// Uses exactly one call, deliberately. Never split into per-seat calls —
// that would blur the boundary between simulated and real.

import type { CouncilSeat, ModelCaller, CouncilLabel } from './real.js';

export interface SimulatedCouncilInput {
  question: string;
  personas: string[];
  caller: ModelCaller;
  model_family: string;
  provider: string;
}

export interface SimulatedDialogueTurn {
  persona: string;
  text: string;
}

export interface SimulatedCouncilResult {
  label: CouncilLabel;
  dialogue: SimulatedDialogueTurn[];
  synthesis: string;
  calls_used: number;
}

export async function runSimulatedCouncil(
  input: SimulatedCouncilInput,
): Promise<SimulatedCouncilResult> {
  const prompt = [
    `Question: ${input.question}`,
    '',
    `Play these personas in a single response: ${input.personas.join(', ')}.`,
    'Format each turn as [persona]: <text>.',
    'End with [synthesis]: your combined answer.',
  ].join('\n');

  const seat: CouncilSeat = {
    persona: 'simulated',
    model_family: input.model_family,
    provider: input.provider,
  };
  const resp = await input.caller({ seat, prompt });

  return {
    label: { kind: 'simulated', label: 'Simulated dissent (single model)' },
    dialogue: parseDialogue(resp.text, input.personas),
    synthesis: extractSynthesis(resp.text) ?? resp.text,
    calls_used: 1,
  };
}

function parseDialogue(
  text: string,
  personas: string[],
): SimulatedDialogueTurn[] {
  const out: SimulatedDialogueTurn[] = [];
  for (const persona of personas) {
    const escaped = persona.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\[${escaped}\\]\\s*([^\\[]*)`, 'i');
    const m = text.match(re);
    if (m && m[1]) {
      out.push({ persona, text: m[1].trim() });
    }
  }
  return out;
}

function extractSynthesis(text: string): string | null {
  const m = text.match(/\[synthesis\]\s*(.+)$/is);
  return m && m[1] ? m[1].trim() : null;
}
// === FILE END ===