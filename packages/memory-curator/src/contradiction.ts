// packages/memory-curator/src/contradiction.ts
// PRD 9.5 contradiction test:
//   "If it conflicts with an existing memory: latest explicit user statement
//    wins, the old one is archived (not deleted) and linked by supersedes_id.
//    Aura-lie says so: 'You previously preferred A. Your latest message says
//    B, so I treated B as current.'"
//
// Detection uses an explicit `subject` field on the candidate. Two memories
// with the same subject but different text are a contradiction. This matches
// the PRD example (subject = "preferred editor"; text = "VS Code" / "Vim").

import type { Memory, MemoryCandidate } from './types.js';

export interface ContradictionCheck {
  contradicts: boolean;
  existing?: Memory;
  message?: string;
}

export function detectContradiction(
  candidate: MemoryCandidate,
  existingActive: Memory[],
): ContradictionCheck {
  if (!candidate.subject) return { contradicts: false };

  const sameSubject = existingActive.filter(
    (m) =>
      m.subject === candidate.subject &&
      m.status === 'active' &&
      m.type === candidate.type,
  );
  if (sameSubject.length === 0) return { contradicts: false };

  const normalized = normalize(candidate.text);
  const conflicting = sameSubject.find((m) => normalize(m.text) !== normalized);
  if (!conflicting) return { contradicts: false };

  const message =
    `You previously said "${conflicting.text}". ` +
    `Your latest message says "${candidate.text}", so I treated ` +
    `"${candidate.text}" as current.`;

  return { contradicts: true, existing: conflicting, message };
}

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase();
}