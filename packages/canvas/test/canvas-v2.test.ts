// === FILE START ===
// packages/canvas/test/canvas-v2.test.ts
// PRD §14.3 · §5.12 · FR-CANVAS-01 · F-075 · T-13.

import { describe, it, expect } from 'vitest';
import {
  createCanvasState,
  openSplit,
  closeSplit,
  openCanvasOnly,
  pushVersion,
  undo,
  redo,
  getCurrent,
  pinVersion,
  unpinVersion,
  diff,
  getDiff,
  VALID_PANE_TRANSITIONS,
  type CanvasState,
} from '../src/canvas-v2.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
let counter = 0;
const fixedNow = () => T0 + ++counter;

// =============================================================================
// Pane transitions
// =============================================================================

describe('canvas — initial state', () => {
  it('starts chat-only with no versions', () => {
    const s = createCanvasState();
    expect(s.pane).toBe('chat-only');
    expect(s.versions.length).toBe(0);
    expect(s.currentIndex).toBe(-1);
    expect(getCurrent(s)).toBeNull();
  });

  it('VALID_PANE_TRANSITIONS covers every pane', () => {
    expect(Object.keys(VALID_PANE_TRANSITIONS).sort()).toEqual([
      'canvas-only',
      'chat-only',
      'split',
    ]);
  });
});

describe('canvas — pane transitions', () => {
  it('openSplit moves chat-only → split', () => {
    const s = openSplit(createCanvasState());
    expect(s.pane).toBe('split');
  });

  it('openSplit is idempotent', () => {
    const s = openSplit(openSplit(createCanvasState()));
    expect(s.pane).toBe('split');
  });

  it('closeSplit returns split → chat-only', () => {
    const s = closeSplit(openSplit(createCanvasState()));
    expect(s.pane).toBe('chat-only');
  });

  it('openCanvasOnly moves to canvas-only', () => {
    const s = openCanvasOnly(createCanvasState());
    expect(s.pane).toBe('canvas-only');
  });

  it('openCanvasOnly from split works', () => {
    const s = openCanvasOnly(openSplit(createCanvasState()));
    expect(s.pane).toBe('canvas-only');
  });

  it('canvas-only → split via openSplit', () => {
    const s = openSplit(openCanvasOnly(createCanvasState()));
    expect(s.pane).toBe('split');
  });
});

// =============================================================================
// Version history
// =============================================================================

describe('canvas — pushVersion', () => {
  it('appends a version and advances currentIndex', () => {
    let s = createCanvasState();
    s = pushVersion(s, 'first draft', 'text', 'user', fixedNow);
    expect(s.versions.length).toBe(1);
    expect(s.currentIndex).toBe(0);
    s = pushVersion(s, 'second draft', 'text', 'user', fixedNow);
    expect(s.versions.length).toBe(2);
    expect(s.currentIndex).toBe(1);
  });

  it('getCurrent returns the version at currentIndex', () => {
    let s = createCanvasState();
    s = pushVersion(s, 'alpha', 'text', 'user', fixedNow);
    s = pushVersion(s, 'beta', 'text', 'user', fixedNow);
    const cur = getCurrent(s);
    expect(cur?.content).toBe('beta');
  });
});

describe('canvas — undo / redo', () => {
  function makeThree(): CanvasState {
    let s = createCanvasState();
    s = pushVersion(s, 'one', 'text', 'user', fixedNow);
    s = pushVersion(s, 'two', 'text', 'user', fixedNow);
    s = pushVersion(s, 'three', 'text', 'user', fixedNow);
    return s;
  }

  it('undo steps back one version', () => {
    let s = makeThree();
    s = undo(s);
    expect(getCurrent(s)?.content).toBe('two');
    expect(s.versions.length).toBe(3);
  });

  it('undo at start is a no-op (same object)', () => {
    let s = makeThree();
    s = undo(undo(undo(s)));
    const same = undo(s);
    expect(same).toBe(s);
    expect(getCurrent(s)?.content).toBe('one');
  });

  it('redo steps forward one version', () => {
    let s = makeThree();
    s = undo(undo(s));
    s = redo(s);
    expect(getCurrent(s)?.content).toBe('two');
  });

  it('redo at end is a no-op (same object)', () => {
    const s = makeThree();
    const same = redo(s);
    expect(same).toBe(s);
    expect(getCurrent(s)?.content).toBe('three');
  });

  it('pushVersion after undo truncates redo history', () => {
    let s = makeThree();
    s = undo(undo(s)); // back to 'one', but versions still [one, two, three]
    s = pushVersion(s, 'branch', 'text', 'user', fixedNow);
    expect(s.versions.length).toBe(2);
    expect(s.versions.map((v) => v.content)).toEqual(['one', 'branch']);
    expect(s.currentIndex).toBe(1);
  });
});

// =============================================================================
// Version pinning
// =============================================================================

describe('canvas — pin / unpin', () => {
  it('pinVersion sets pinned=true on the matching id only', () => {
    let s = createCanvasState();
    s = pushVersion(s, 'a', 'text', 'user', fixedNow);
    s = pushVersion(s, 'b', 'text', 'user', fixedNow);
    const id = s.versions[0]!.id;
    s = pinVersion(s, id);
    expect(s.versions[0]!.pinned).toBe(true);
    expect(s.versions[1]!.pinned).toBe(false);
  });

  it('unpinVersion clears pinned', () => {
    let s = createCanvasState();
    s = pushVersion(s, 'a', 'text', 'user', fixedNow);
    const id = s.versions[0]!.id;
    s = pinVersion(s, id);
    s = unpinVersion(s, id);
    expect(s.versions[0]!.pinned).toBe(false);
  });
});

// =============================================================================
// Diff
// =============================================================================

describe('canvas — diff', () => {
  it('identical versions → 0 additions / 0 removals', () => {
    const a = { id: 'a', content: 'same\ntext', contentType: 'text' as const, createdAt: '', source: 'user' as const, pinned: false };
    const b = { ...a, id: 'b' };
    const d = diff(a, b);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.summary).toBe('0 additions, 0 removals');
  });

  it('added line is detected', () => {
    const a = { id: 'a', content: 'alpha', contentType: 'text' as const, createdAt: '', source: 'user' as const, pinned: false };
    const b = { ...a, id: 'b', content: 'alpha\nbeta' };
    const d = diff(a, b);
    expect(d.added).toEqual(['beta']);
    expect(d.removed).toEqual([]);
    expect(d.summary).toBe('1 addition, 0 removals');
  });

  it('removed line is detected', () => {
    const a = { id: 'a', content: 'alpha\nbeta', contentType: 'text' as const, createdAt: '', source: 'user' as const, pinned: false };
    const b = { ...a, id: 'b', content: 'alpha' };
    const d = diff(a, b);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(['beta']);
    expect(d.summary).toBe('0 additions, 1 removal');
  });

  it('getDiff returns null when there is no previous version', () => {
    const s = createCanvasState();
    expect(getDiff(s)).toBeNull();
  });

  it('getDiff between prev and current returns a DiffResult', () => {
    let s = createCanvasState();
    s = pushVersion(s, 'one', 'text', 'user', fixedNow);
    s = pushVersion(s, 'one\ntwo', 'text', 'user', fixedNow);
    const d = getDiff(s);
    expect(d).not.toBeNull();
    expect(d!.added).toEqual(['two']);
  });
});
// === FILE END ===