// === FILE START ===
// packages/agents/src/diary-v2.ts
// PRD §11.9 · §11.11 · FR-PRO-14 · F-279 · T-13.
//
// Local-only diary. Companion pack, off by default.
//
//   · Every entry is S2 by default (emotional content)
//   · Never sent to any provider
//   · Never read by the assistant unless the user explicitly opens it
//   · Fully deletable
//   · No guilt mechanics in any copy
//
// Zero external imports.

export type DiaryMood = 'quiet' | 'low' | 'steady' | 'up' | 'unset';

export interface DiaryEntry {
  id: string;
  text: string;
  createdAt: number;
  mood: DiaryMood;
  /** Fixed to 'S2'. Kept on the record so any export cannot be S0/S1. */
  sensitivity: 'S2';
}

export interface DiaryValidation {
  ok: boolean;
  error?: string;
}

const MOODS: readonly DiaryMood[] = ['quiet', 'low', 'steady', 'up', 'unset'];

export function validateEntry(input: {
  id: string;
  text: string;
  createdAt: number;
  mood?: DiaryMood;
}): DiaryValidation {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    return { ok: false, error: 'text must be non-empty' };
  }
  if (!Number.isFinite(input.createdAt)) {
    return { ok: false, error: 'createdAt must be a finite number' };
  }
  if (input.mood !== undefined && !MOODS.includes(input.mood)) {
    return { ok: false, error: `mood must be one of: ${MOODS.join(', ')}` };
  }
  return { ok: true };
}

const registry: Map<string, DiaryEntry> = new Map();

function clone(e: DiaryEntry): DiaryEntry {
  return { ...e };
}

export function addEntry(input: {
  id: string;
  text: string;
  createdAt: number;
  mood?: DiaryMood;
}): DiaryValidation {
  const v = validateEntry(input);
  if (!v.ok) return v;
  const entry: DiaryEntry = {
    id: input.id,
    text: input.text,
    createdAt: input.createdAt,
    mood: input.mood ?? 'unset',
    sensitivity: 'S2',
  };
  registry.set(entry.id, entry);
  return { ok: true };
}

export function listEntries(): DiaryEntry[] {
  return Array.from(registry.values())
    .map(clone)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteEntry(id: string): boolean {
  return registry.delete(id);
}

export function clearDiary(): void {
  registry.clear();
}

export function entryCount(): number {
  return registry.size;
}

/**
 * Copy for the empty state. No guilt, no FOMO, no "come back".
 */
export function renderEmptyState(): string {
  return 'Nothing here yet. This stays on this device.';
}

/**
 * Copy shown before the diary is opened for the first time. Explicitly
 * states: not a therapist. Offers one path to real support. Never prompts
 * again unless the user asks.
 */
export function renderNotTherapistDisclosure(): string {
  return (
    'This is a diary, not a therapist. If you are in crisis, contact a ' +
    'local emergency number or Tele-MANAS 14416 (India).'
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