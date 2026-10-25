// === FILE START ===
// packages/proactive/src/composer-v2.ts
// PRD 10.6 · FR-PRO-06.
//
// The proactive message composer. Every note must have:
//   - body ≤ 40 words
//   - a "why you're seeing this" line
//   - one action button (default: Open / Snooze / Never)
//
// The composer validates model output before it goes out. If the model
// writes 87 words, the body is truncated AND marked invalid so the
// caller knows to re-draft or accept the truncation.

export type TriggerType =
  | 'reminder'
  | 'deadline'
  | 'open_loop'
  | 'project_change'
  | 'promise_completed'
  | 'watched_source'
  | 'follow_up';

export const MAX_WORDS = 40;
export const DEFAULT_ACTIONS: readonly string[] = ['Open', 'Snooze', 'Never'];

export interface ComposeInput {
  trigger: TriggerType;
  bodyText: string;
  whyText: string;
  actions?: string[];
}

export interface ComposedNote {
  body: string;
  why: string;
  wordCount: number;
  actions: string[];
  valid: boolean;
  reason?: string;
}

export function composeProactiveNote(input: ComposeInput): ComposedNote {
  const actions =
    input.actions && input.actions.length > 0
      ? [...input.actions]
      : [...DEFAULT_ACTIONS];
  const words = input.bodyText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount === 0) {
    return {
      body: '',
      why: input.whyText,
      wordCount: 0,
      actions,
      valid: false,
      reason: 'empty body',
    };
  }

  if (input.whyText.trim().length === 0) {
    return {
      body: input.bodyText,
      why: '',
      wordCount,
      actions,
      valid: false,
      reason: 'missing why-text (PRD 10.5 requires "why you\'re seeing this")',
    };
  }

  if (wordCount > MAX_WORDS) {
    const truncated = words.slice(0, MAX_WORDS).join(' ');
    return {
      body: truncated,
      why: input.whyText,
      wordCount,
      actions,
      valid: false,
      reason: `body exceeds ${MAX_WORDS} words (${wordCount}); truncated to ${MAX_WORDS}`,
    };
  }

  return {
    body: input.bodyText,
    why: input.whyText,
    wordCount,
    actions,
    valid: true,
  };
}
// === FILE END ===