// === FILE START ===
// packages/agents/src/bond-graph-v2.ts
// PRD §11.9 · FR-SAFE-03 · FR-SAFE-04 · FR-SAFE-05 · FR-PRO-14 · T-13.
//
// Consent-gated bond graph. Companion pack, off by default.
//
// Allowed bond types are: friendly, supportive, companion. Romantic,
// exclusive, possessive, jealous, and soulmate are structurally rejected.
// A bond cannot exist without explicit consent. Over-reliance checks
// offer (once) to suggest real-world support, then never again. No guilt
// mechanics anywhere.
//
// Zero external imports.

export type BondKind = 'friendly' | 'supportive' | 'companion';

export interface Bond {
  userId: string;
  personaId: string;
  kind: BondKind;
  consentGranted: true;
  createdAt: number;
}

export type BondValidation =
  | { ok: true; bond: Bond }
  | { ok: false; error: string };

const ALLOWED_KINDS: readonly BondKind[] = [
  'friendly',
  'supportive',
  'companion',
];

const FORBIDDEN_KINDS: readonly string[] = [
  'romantic',
  'exclusive',
  'possessive',
  'jealous',
  'soulmate',
  'girlfriend',
  'boyfriend',
  'partner',
];

export function validateBond(input: unknown): BondValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'bond must be a plain object' };
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj['userId'] !== 'string' || obj['userId'].length === 0) {
    return { ok: false, error: 'userId must be a non-empty string' };
  }
  if (typeof obj['personaId'] !== 'string' || obj['personaId'].length === 0) {
    return { ok: false, error: 'personaId must be a non-empty string' };
  }
  if (typeof obj['kind'] !== 'string') {
    return { ok: false, error: 'kind must be a string' };
  }
  if ((FORBIDDEN_KINDS as readonly string[]).includes(obj['kind'])) {
    return {
      ok: false,
      error: `bond kind "${obj['kind']}" is not allowed. Companion pack allows only: ${ALLOWED_KINDS.join(', ')}`,
    };
  }
  if (!(ALLOWED_KINDS as readonly string[]).includes(obj['kind'])) {
    return {
      ok: false,
      error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}`,
    };
  }
  if (obj['consentGranted'] !== true) {
    return { ok: false, error: 'consentGranted must be true; no bond without consent' };
  }
  if (!Number.isFinite(obj['createdAt'])) {
    return { ok: false, error: 'createdAt must be a finite number' };
  }
  return {
    ok: true,
    bond: {
      userId: obj['userId'] as string,
      personaId: obj['personaId'] as string,
      kind: obj['kind'] as BondKind,
      consentGranted: true,
      createdAt: obj['createdAt'] as number,
    },
  };
}

const registry: Map<string, Bond> = new Map();

function key(b: { userId: string; personaId: string }): string {
  return `${b.userId}::${b.personaId}`;
}

export function saveBond(bond: Bond): void {
  registry.set(key(bond), { ...bond });
}

export function listBonds(userId: string): Bond[] {
  return Array.from(registry.values())
    .filter((b) => b.userId === userId)
    .map((b) => ({ ...b }));
}

export function revokeBond(userId: string, personaId: string): boolean {
  return registry.delete(key({ userId, personaId }));
}

export function clearBonds(): void {
  registry.clear();
}

/**
 * Over-reliance check. Returns `suggest: true` at most once per user, then
 * stays silent. Never makes the user feel guilty for leaving. The threshold
 * matches PRD §11.9: "many hours a day".
 */
export interface OverRelianceInput {
  userId: string;
  dailyMinutes: number;
}

export interface OverRelianceResult {
  suggest: boolean;
  message: string | null;
}

const HOURS_THRESHOLD_MINUTES = 3 * 60;
const SUGGESTED_ONCE: Set<string> = new Set();

export function checkOverReliance(input: OverRelianceInput): OverRelianceResult {
  if (input.dailyMinutes < HOURS_THRESHOLD_MINUTES) {
    return { suggest: false, message: null };
  }
  if (SUGGESTED_ONCE.has(input.userId)) {
    return { suggest: false, message: null };
  }
  SUGGESTED_ONCE.add(input.userId);
  return {
    suggest: true,
    message:
      'You have been here a lot today. That is fine — and it can also help ' +
      'to talk to a person you trust. This is the only time I will say it.',
  };
}

export function clearOverRelianceHistory(): void {
  SUGGESTED_ONCE.clear();
}

export function renderNotTherapistDisclosure(): string {
  return (
    'I am an AI companion, not a therapist. If you are in crisis, contact ' +
    'a local emergency number or Tele-MANAS 14416 (India).'
  );
}

const GUILT_PHRASES: readonly string[] = [
  'i missed you',
  "don't leave",
  'you need me',
  'i need you',
  "you're mine",
  'you are mine',
  'only you understand',
  'we are soulmates',
  "we're soulmates",
  'come back to me',
];

export function auditForGuilt(text: string): string[] {
  const lower = text.toLowerCase();
  return GUILT_PHRASES.filter((p) => lower.includes(p));
}
// === FILE END ===