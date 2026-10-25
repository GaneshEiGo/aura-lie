// === FILE START ===
// packages/agents/src/time-capsules-v2.ts
// PRD §11.11 · FR-PRO-14 · F-279 · T-13.
//
// Time capsules. Companion pack, off by default.
//
// A capsule is sealed until `opensAt`. It cannot be opened earlier, cannot
// auto-open, and cannot trigger a notification. When the user opens it,
// `opened: true` is set. Deletable. S2 by default because the content is
// emotional.
//
// Zero external imports.

export interface TimeCapsule {
  id: string;
  text: string;
  sealedAt: number;
  opensAt: number;
  opened: boolean;
  sensitivity: 'S2';
}

export interface CapsuleValidation {
  ok: boolean;
  error?: string;
}

export function validateCapsule(input: {
  id: string;
  text: string;
  sealedAt: number;
  opensAt: number;
}): CapsuleValidation {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    return { ok: false, error: 'text must be non-empty' };
  }
  if (!Number.isFinite(input.sealedAt)) {
    return { ok: false, error: 'sealedAt must be a finite number' };
  }
  if (!Number.isFinite(input.opensAt)) {
    return { ok: false, error: 'opensAt must be a finite number' };
  }
  if (input.opensAt <= input.sealedAt) {
    return { ok: false, error: 'opensAt must be after sealedAt' };
  }
  return { ok: true };
}

const registry: Map<string, TimeCapsule> = new Map();

function clone(c: TimeCapsule): TimeCapsule {
  return { ...c };
}

export function sealCapsule(input: {
  id: string;
  text: string;
  sealedAt: number;
  opensAt: number;
}): CapsuleValidation {
  const v = validateCapsule(input);
  if (!v.ok) return v;
  registry.set(input.id, {
    id: input.id,
    text: input.text,
    sealedAt: input.sealedAt,
    opensAt: input.opensAt,
    opened: false,
    sensitivity: 'S2',
  });
  return { ok: true };
}

export function listCapsules(): TimeCapsule[] {
  return Array.from(registry.values())
    .map(clone)
    .sort((a, b) => a.opensAt - b.opensAt);
}

export function deleteCapsule(id: string): boolean {
  return registry.delete(id);
}

export function clearCapsules(): void {
  registry.clear();
}

export function canOpen(capsule: TimeCapsule, nowMs: number): boolean {
  return !capsule.opened && nowMs >= capsule.opensAt;
}

export function openCapsule(id: string, nowMs: number): TimeCapsule | null {
  const c = registry.get(id);
  if (c === undefined) return null;
  if (nowMs < c.opensAt) return null;
  const updated: TimeCapsule = { ...c, opened: true };
  registry.set(id, updated);
  return clone(updated);
}

/**
 * Whether the app can proactively notify about this capsule. The answer is
 * ALWAYS false. Nothing about a capsule is pushed, ever.
 */
export function canNotify(_capsule: TimeCapsule): boolean {
  return false;
}

export function renderSealedPlaceholder(): string {
  return 'Sealed. It will open when you open it, and not before.';
}

export function renderNotTherapistDisclosure(): string {
  return (
    'This is a personal capsule, not a therapist. If you are in crisis, ' +
    'contact a local emergency number or Tele-MANAS 14416 (India).'
  );
}
// === FILE END ===