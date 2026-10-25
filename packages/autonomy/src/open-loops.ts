// === FILE START ===
// packages/autonomy/src/open-loops.ts
// PRD §10.7 · F-088 · FR-PRO-08.
//
// Open loops are unresolved threads Aura-lie or the user said they would
// return to ("verify the number", "finish the diagram"). They are surfaced
// only through Inbox rules and the daily brief, never as nag popups.
//
// Lifecycle: open → closed | abandoned. Close reasons: done, not-useful,
// never-about-this, abandoned, user-dismissed. Auto-abandon after 60 days.

export type OpenLoopStatus = 'open' | 'closed' | 'abandoned';

export type OpenLoopCloseReason =
  | 'done'
  | 'not-useful'
  | 'never-about-this'
  | 'abandoned'
  | 'user-dismissed';

export interface OpenLoop {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  due_at: string | null;
  status: OpenLoopStatus;
  closed_at: string | null;
  close_reason: OpenLoopCloseReason | null;
  source: 'user' | 'aura-lie';
  project_id: string | null;
  last_surfaced_at: string | null;
  surface_count: number;
  priority: 1 | 2 | 3;
}

export interface CreateOpenLoopInput {
  title: string;
  summary?: string;
  due_at?: string | null;
  source?: 'user' | 'aura-lie';
  project_id?: string | null;
  priority?: 1 | 2 | 3;
  now?: () => number;
  idFactory?: () => string;
}

const DEFAULT_PRIORITY: 1 | 2 | 3 = 2;
export const AUTO_ABANDON_DAYS = 60;

export function createOpenLoop(input: CreateOpenLoopInput): OpenLoop {
  const now = input.now ?? Date.now;
  const iso = new Date(now()).toISOString();
  const id = input.idFactory
    ? input.idFactory()
    : `loop-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: input.title,
    summary: input.summary ?? '',
    created_at: iso,
    due_at: input.due_at ?? null,
    status: 'open',
    closed_at: null,
    close_reason: null,
    source: input.source ?? 'user',
    project_id: input.project_id ?? null,
    last_surfaced_at: null,
    surface_count: 0,
    priority: input.priority ?? DEFAULT_PRIORITY,
  };
}

export interface CloseOptions {
  now?: () => number;
}

export function closeOpenLoop(
  loop: OpenLoop,
  reason: OpenLoopCloseReason,
  opts: CloseOptions = {},
): OpenLoop {
  if (loop.status !== 'open') {
    throw new Error(`closeOpenLoop: loop ${loop.id} is ${loop.status}, not open`);
  }
  const now = opts.now ?? Date.now;
  return {
    ...loop,
    status: reason === 'abandoned' ? 'abandoned' : 'closed',
    closed_at: new Date(now()).toISOString(),
    close_reason: reason,
  };
}

export function markSurfaced(
  loop: OpenLoop,
  opts: CloseOptions = {},
): OpenLoop {
  const now = opts.now ?? Date.now;
  return {
    ...loop,
    last_surfaced_at: new Date(now()).toISOString(),
    surface_count: loop.surface_count + 1,
  };
}

export interface AbandonOptions {
  now?: () => number;
  staleAfterDays?: number;
}

export function abandonStaleOpenLoops(
  loops: OpenLoop[],
  opts: AbandonOptions = {},
): OpenLoop[] {
  const now = (opts.now ?? Date.now)();
  const staleAfterDays = opts.staleAfterDays ?? AUTO_ABANDON_DAYS;
  const cutoff = now - staleAfterDays * 24 * 60 * 60 * 1000;
  return loops.map((loop) => {
    if (loop.status !== 'open') return loop;
    if (Date.parse(loop.created_at) >= cutoff) return loop;
    return {
      ...loop,
      status: 'abandoned',
      closed_at: new Date(now).toISOString(),
      close_reason: 'abandoned',
    };
  });
}

export interface SurfaceContext {
  autonomyLevel: 0 | 1 | 2 | 3;
  notesSentToday: number;
  notesCap: number;
  /** Current local hour, 0–23. */
  localHour: number;
  quietHoursStart?: number; // default 23
  quietHoursEnd?: number;   // default 8
}

export type SurfaceReason =
  | 'ok'
  | 'quiet-hours'
  | 'cap-reached'
  | 'level-0'
  | 'recently-surfaced'
  | 'closed';

export interface SurfaceDecision {
  surface: boolean;
  reason: SurfaceReason;
}

export interface ShouldSurfaceOptions {
  now?: () => number;
  minHoursSinceLastSurface?: number;
}

export function shouldSurfaceOpenLoop(
  loop: OpenLoop,
  ctx: SurfaceContext,
  opts: ShouldSurfaceOptions = {},
): SurfaceDecision {
  if (loop.status !== 'open') return { surface: false, reason: 'closed' };
  if (ctx.autonomyLevel === 0) return { surface: false, reason: 'level-0' };
  if (ctx.notesSentToday >= ctx.notesCap) return { surface: false, reason: 'cap-reached' };

  const quietStart = ctx.quietHoursStart ?? 23;
  const quietEnd = ctx.quietHoursEnd ?? 8;
  const inQuiet =
    quietStart > quietEnd
      ? ctx.localHour >= quietStart || ctx.localHour < quietEnd
      : ctx.localHour >= quietStart && ctx.localHour < quietEnd;
  if (inQuiet) return { surface: false, reason: 'quiet-hours' };

  if (loop.last_surfaced_at) {
    const minHours = opts.minHoursSinceLastSurface ?? 24;
    const since =
      ((opts.now ?? Date.now)() - Date.parse(loop.last_surfaced_at)) / 3_600_000;
    if (since < minHours) return { surface: false, reason: 'recently-surfaced' };
  }

  return { surface: true, reason: 'ok' };
}

export function listOpen(loops: OpenLoop[]): OpenLoop[] {
  return loops
    .filter((l) => l.status === 'open')
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.due_at && b.due_at) return Date.parse(a.due_at) - Date.parse(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
}
// === FILE END ===