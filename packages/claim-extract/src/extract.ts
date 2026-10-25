// === FILE START ===
// packages/claim-extract/src/extract.ts
// PRD 8.3 · F-031 · FR-TRUTH-01/08.

import { splitAtomic } from './atomic.js';
import { classifyClaim } from './classify.js';
import type { Claim, ClaimOrigin, ExtractOptions } from './types.js';

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `c_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

const DEFAULT_CAP = 25;
const MIN_CLAIM_LENGTH = 5;

export function extractClaims(
  text: string,
  options: ExtractOptions = {},
): Claim[] {
  const messageId = options.messageId ?? 'msg';
  const origin: ClaimOrigin = options.origin ?? 'MODEL';
  const cap = options.cap ?? DEFAULT_CAP;

  const input = (text ?? '').trim();
  if (input.length === 0) return [];

  const atoms = splitAtomic(input);
  const out: Claim[] = [];

  for (let i = 0; i < atoms.length && out.length < cap; i++) {
    const atom = atoms[i];
    if (atom.length < MIN_CLAIM_LENGTH) continue;

    const classification = classifyClaim(atom);
    out.push({
      id: nextId(),
      messageId,
      text: atom,
      type: classification.type,
      checkable: classification.checkable,
      importance: i === 0 ? 'central' : 'supporting',
      volatility: classification.volatility,
      origin,
    });
  }

  return out;
}
// === FILE END ===