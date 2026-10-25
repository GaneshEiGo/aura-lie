// packages/memory-curator/src/importance.ts
// PRD 9.5 importance test: "Durable, reusable, and likely to matter again.
// Chit-chat is discarded."

const CHIT_CHAT = new RegExp(
  '^(' +
    'lol|lmao|rofl|haha+|hehe+|hmm+|yeah+|yep|nope|ok|okay|k|sure|fine|cool|' +
    'nice|thanks|thank\\s+you|thx|ty|hi|hello|hey|yo|bye|goodbye|got\\s+it|' +
    'sounds\\s+good|no\\s+problem|np|alright|word|true|false|yes|no' +
  ')$',
  'i',
);

const MIN_LENGTH = 15;

export type ImportanceVerdict = 'store' | 'discard';

export interface ImportanceAssessment {
  verdict: ImportanceVerdict;
  reason: string;
}

export function assessImportance(text: string): ImportanceAssessment {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) {
    return { verdict: 'discard', reason: 'empty' };
  }
  if (trimmed.length < MIN_LENGTH) {
    return { verdict: 'discard', reason: 'too short' };
  }
  if (CHIT_CHAT.test(trimmed)) {
    return { verdict: 'discard', reason: 'chit-chat' };
  }
  return { verdict: 'store', reason: 'meaningful' };
}