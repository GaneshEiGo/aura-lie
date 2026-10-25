// === FILE START ===
// packages/canvas/src/canvas-v2.ts
// PRD §14.3 · §5.12 · FR-CANVAS-01 · F-075 · T-13.
//
// Split view + editable canvas + version history.
//
// PRD §14.3:
//   "Split view (laptop): Chat on the left, a workspace on the right:
//    document, table, code, graph or PDF. Appears only when useful."
//   "Focus canvas: A response can open full screen as a document. Chat
//    hides temporarily."
//
// PRD §5.12:
//   "1100 px and wider (desktop): Centre column up to 720 px. Inspector
//    docks right at 360 px when open."
//
// State machine:
//   chat-only  →  split        (openSplit)
//   chat-only  →  canvas-only  (openCanvasOnly)
//   split      →  chat-only    (closeSplit)
//   split      →  canvas-only  (openCanvasOnly)
//   canvas-only→  chat-only    (closeSplit)
//   canvas-only→  split        (openSplit)
//
// Version model (undo/redo):
//   · versions is the full timeline
//   · currentIndex points at the version shown in the canvas
//   · pushVersion TRUNCATES any redos after currentIndex (standard editor
//     behaviour) and appends the new version
//   · undo decrements currentIndex (no-op at 0)
//   · redo increments currentIndex (no-op at length-1)
//   · pinned versions survive undo/redo truncation by being in the versions
//     list already; pinning just marks a flag
//
// No imports at all. T-13 laptop-safety proof: this module only manipulates
// plain JS objects. Zero external dependency (see the source-scan tests).

export type Pane = 'chat-only' | 'split' | 'canvas-only';

export type ContentType = 'text' | 'code' | 'table' | 'diagram';

export type VersionSource = 'user' | 'aura-lie';

export interface CanvasVersion {
  id: string;
  content: string;
  contentType: ContentType;
  createdAt: string;
  source: VersionSource;
  pinned: boolean;
}

export interface CanvasState {
  pane: Pane;
  versions: CanvasVersion[];
  /** Index into versions of the currently displayed version (-1 when empty). */
  currentIndex: number;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  unchanged: number;
  summary: string;
}

/** Allowed pane transitions. Exposed for tests and UI hints. */
export const VALID_PANE_TRANSITIONS: Readonly<Record<Pane, Pane[]>> = Object.freeze({
  'chat-only': ['split', 'canvas-only'],
  'split': ['chat-only', 'canvas-only'],
  'canvas-only': ['chat-only', 'split'],
});

// -----------------------------------------------------------------------------
// Construction and pane transitions
// -----------------------------------------------------------------------------

export function createCanvasState(): CanvasState {
  return { pane: 'chat-only', versions: [], currentIndex: -1 };
}

function assertTransition(state: CanvasState, target: Pane): void {
  const allowed = VALID_PANE_TRANSITIONS[state.pane];
  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid pane transition ${state.pane} → ${target}. Allowed: ${allowed.join(', ')}.`,
    );
  }
}

export function openSplit(state: CanvasState): CanvasState {
  if (state.pane === 'split') return state;
  assertTransition(state, 'split');
  return { ...state, pane: 'split' };
}

export function closeSplit(state: CanvasState): CanvasState {
  if (state.pane === 'chat-only') return state;
  assertTransition(state, 'chat-only');
  return { ...state, pane: 'chat-only' };
}

export function openCanvasOnly(state: CanvasState): CanvasState {
  if (state.pane === 'canvas-only') return state;
  assertTransition(state, 'canvas-only');
  return { ...state, pane: 'canvas-only' };
}

// -----------------------------------------------------------------------------
// Version history
// -----------------------------------------------------------------------------

export function pushVersion(
  state: CanvasState,
  content: string,
  contentType: ContentType,
  source: VersionSource = 'user',
  now: () => number = Date.now,
): CanvasState {
  const t = now();
  const version: CanvasVersion = {
    id: `v-${t}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    contentType,
    createdAt: new Date(t).toISOString(),
    source,
    pinned: false,
  };
  // Truncate anything the user had undone (standard editor behaviour).
  const kept = state.versions.slice(0, state.currentIndex + 1);
  return {
    ...state,
    versions: [...kept, version],
    currentIndex: kept.length,
  };
}

export function undo(state: CanvasState): CanvasState {
  if (state.currentIndex <= 0) return state;
  return { ...state, currentIndex: state.currentIndex - 1 };
}

export function redo(state: CanvasState): CanvasState {
  if (state.currentIndex >= state.versions.length - 1) return state;
  return { ...state, currentIndex: state.currentIndex + 1 };
}

export function getCurrent(state: CanvasState): CanvasVersion | null {
  if (state.currentIndex < 0 || state.currentIndex >= state.versions.length) {
    return null;
  }
  return state.versions[state.currentIndex]!;
}

export function pinVersion(state: CanvasState, versionId: string): CanvasState {
  return {
    ...state,
    versions: state.versions.map((v) =>
      v.id === versionId ? { ...v, pinned: true } : v,
    ),
  };
}

export function unpinVersion(state: CanvasState, versionId: string): CanvasState {
  return {
    ...state,
    versions: state.versions.map((v) =>
      v.id === versionId ? { ...v, pinned: false } : v,
    ),
  };
}

// -----------------------------------------------------------------------------
// Diff
// -----------------------------------------------------------------------------

/**
 * Line-level diff between two versions. Deterministic: same input → same
 * output, character for character. No LCS — the cheaper set-based diff is
 * sufficient for the "What changed?" affordance (PRD §9.11, FR-TRUTH-16).
 */
export function diff(a: CanvasVersion, b: CanvasVersion): DiffResult {
  const aLines = a.content.split('\n');
  const bLines = b.content.split('\n');
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);
  const added = bLines.filter((l) => !aSet.has(l));
  const removed = aLines.filter((l) => !bSet.has(l));
  const unchanged = aLines.length - removed.length;
  return {
    added,
    removed,
    unchanged,
    summary: `${added.length} addition${added.length === 1 ? '' : 's'}, ${removed.length} removal${removed.length === 1 ? '' : 's'}`,
  };
}

/**
 * Diff between the previous and current versions. Returns null when there is
 * no previous version (fresh canvas or at the start of history).
 */
export function getDiff(state: CanvasState): DiffResult | null {
  if (state.currentIndex <= 0) return null;
  const prev = state.versions[state.currentIndex - 1]!;
  const curr = state.versions[state.currentIndex]!;
  return diff(prev, curr);
}
// === FILE END ===