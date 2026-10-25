// === FILE START ===
// packages/agents/test/time-capsules-v2.test.ts
// PRD §11.11 · FR-PRO-14 · F-279.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sealCapsule,
  listCapsules,
  deleteCapsule,
  clearCapsules,
  canOpen,
  openCapsule,
  canNotify,
  renderSealedPlaceholder,
  renderNotTherapistDisclosure,
  validateCapsule,
} from '../src/time-capsules-v2.js';

beforeEach(() => {
  clearCapsules();
});

describe('capsule — seal and shape', () => {
  it('accepts a valid capsule; store contains it as S2 and opened:false', () => {
    const r = sealCapsule({ id: 'c1', text: 'a note to future me', sealedAt: 0, opensAt: 1000 });
    expect(r.ok).toBe(true);
    const list = listCapsules();
    expect(list.length).toBe(1);
    expect(list[0]!.sensitivity).toBe('S2');
    expect(list[0]!.opened).toBe(false);
  });

  it('rejects opensAt <= sealedAt', () => {
    expect(validateCapsule({ id: 'c1', text: 'x', sealedAt: 1000, opensAt: 1000 }).ok).toBe(false);
    expect(validateCapsule({ id: 'c1', text: 'x', sealedAt: 2000, opensAt: 1000 }).ok).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(validateCapsule({ id: '', text: 'x', sealedAt: 0, opensAt: 1000 }).ok).toBe(false);
  });

  it('rejects empty text', () => {
    expect(validateCapsule({ id: 'c1', text: '   ', sealedAt: 0, opensAt: 1000 }).ok).toBe(false);
  });
});

describe('capsule — canOpen respects the seal', () => {
  it('returns false before opensAt', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 1000 });
    const capsule = listCapsules()[0]!;
    expect(canOpen(capsule, 500)).toBe(false);
  });

  it('returns true at opensAt (inclusive)', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 1000 });
    const capsule = listCapsules()[0]!;
    expect(canOpen(capsule, 1000)).toBe(true);
    expect(canOpen(capsule, 5000)).toBe(true);
  });
});

describe('capsule — openCapsule', () => {
  it('returns null before opensAt', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 1000 });
    expect(openCapsule('c1', 500)).toBeNull();
  });

  it('returns the capsule and marks opened:true at/after opensAt', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 1000 });
    const opened = openCapsule('c1', 1000);
    expect(opened).not.toBeNull();
    expect(opened!.opened).toBe(true);
    expect(listCapsules()[0]!.opened).toBe(true);
  });

  it('returns null for an unknown id', () => {
    expect(openCapsule('missing', 9999)).toBeNull();
  });
});

describe('capsule — no proactive notification, ever', () => {
  it('canNotify always returns false', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 1000 });
    const capsule = listCapsules()[0]!;
    expect(canNotify(capsule)).toBe(false);
  });
});

describe('capsule — ordering, delete, clear', () => {
  it('listCapsules sorts by opensAt ascending; delete and clear work', () => {
    sealCapsule({ id: 'c1', text: 'x', sealedAt: 0, opensAt: 3000 });
    sealCapsule({ id: 'c2', text: 'y', sealedAt: 0, opensAt: 1000 });
    sealCapsule({ id: 'c3', text: 'z', sealedAt: 0, opensAt: 2000 });
    expect(listCapsules().map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    expect(deleteCapsule('c2')).toBe(true);
    expect(deleteCapsule('missing')).toBe(false);
    clearCapsules();
    expect(listCapsules().length).toBe(0);
  });
});

describe('capsule — copy', () => {
  it('renderSealedPlaceholder and disclosure are guilt-free; disclosure names Tele-MANAS', () => {
    const sealed = renderSealedPlaceholder();
    expect(sealed.toLowerCase()).not.toContain('missed');
    expect(sealed.toLowerCase()).not.toContain('come back');

    const disclosure = renderNotTherapistDisclosure();
    expect(disclosure).toContain('not a therapist');
    expect(disclosure).toContain('14416');
  });
});

describe('capsule — source scan', () => {
  it('source scan: time-capsules-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'time-capsules-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===