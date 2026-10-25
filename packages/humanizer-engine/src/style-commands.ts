// packages/humanizer-engine/src/style-commands.ts
// PRD 7.14: style commands change format only, never truth.
//
// Each command returns a short directive the caller prepends to the prompt.

import type { StyleCommand } from './types.js';

export const STYLE_DIRECTIVES: Record<StyleCommand, string> = {
  minimal:
    'Answer, one-line why, a confidence word. Nothing else.',
  human:
    'Shorter sentences, natural rhythm, less structure, no headings.',
  terminal:
    'A monospace session card: model, mode, memory, claims, sources, tools, status.',
  zen:
    'One sentence on screen. Everything else collapsed.',
  raw:
    'Shows model, route, tools, memory IDs, claim IDs, latency, tokens.',
  'facts only':
    'Removes inference, opinion and creative claims, or labels them.',
  'straight talk':
    'No filler, no motivation talk, no invented certainty: facts, reasoning, uncertainty, action. Says when an idea is weak and why.',
};

/** Returns the directive, or null if the string is not a style command. */
export function lookupStyleCommand(input: string): string | null {
  const normalized = input.trim().toLowerCase();
  if (normalized in STYLE_DIRECTIVES) {
    return STYLE_DIRECTIVES[normalized as StyleCommand];
  }
  return null;
}

/** Parse a leading slash or plain-text command from a user message. */
export function extractStyleCommand(
  message: string,
): { style: StyleCommand; rest: string } | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  for (const cmd of Object.keys(STYLE_DIRECTIVES) as StyleCommand[]) {
    if (lower === cmd) return { style: cmd, rest: '' };
    if (lower.startsWith(cmd + ' ')) {
      return { style: cmd, rest: trimmed.slice(cmd.length).trim() };
    }
  }
  return null;
}