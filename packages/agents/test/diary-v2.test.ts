// === FILE START ===
// packages/agents/test/diary-v2.test.ts
// PRD §11.9 · FR-PRO-14 · F-279.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addEntry,
  listEntries,
  deleteEntry,
  clearDiary,
  entryCount,
  renderEmptyState,
  renderNotTherapistDisclosure,
  auditForGuilt,
} from '../src/diary-v2.js';

beforeEach(() => {
  clearDiary();
});

describe('diary — empty state', () => {
  it('empty diary → empty list and zero count', () => {
    expect(listEntries()).toEqual([]);
    expect(entryCount()).toBe(0);
  });
});

describe('diary — addEntry accepts good data', () => {
  it('accepts a valid entry, marks it S2, mood defaults to "unset"', () => {
    const r = addEntry({ id: 'd1', text: 'Hello', createdAt: 1000 });
    expect(r.ok).toBe(true);
    const list = listEntries();
    expect(list.length).toBe(1);
    expect(list[0]!.sensitivity).toBe('S2');
    expect(list[0]!.mood).toBe('unset');
  });
});

describe('diary — addEntry rejections', () => {
  it('rejects an empty id', () => {
    expect(addEntry({ id: '', text: 'x', createdAt: 1000 }).ok).toBe(false);
  });

  it('rejects empty text', () => {
    expect(addEntry({ id: 'd1', text: '   ', createdAt: 1000 }).ok).toBe(false);
  });

  it('rejects a non-finite createdAt', () => {
    expect(addEntry({ id: 'd1', text: 'x', createdAt: NaN }).ok).toBe(false);
  });

  it('rejects an unknown mood', () => {
    // @ts-expect-error deliberate unknown mood
    expect(addEntry({ id: 'd1', text: 'x', createdAt: 1000, mood: 'angry' }).ok).toBe(false);
  });
});

describe('diary — delete and clear', () => {
  it('deleteEntry removes and reports success; missing id returns false', () => {
    addEntry({ id: 'd1', text: 'a', createdAt: 1000 });
    addEntry({ id: 'd2', text: 'b', createdAt: 2000 });
    expect(deleteEntry('d1')).toBe(true);
    expect(deleteEntry('missing')).toBe(false);
    expect(listEntries().length).toBe(1);
  });

  it('clearDiary empties the store', () => {
    addEntry({ id: 'd1', text: 'a', createdAt: 1000 });
    addEntry({ id: 'd2', text: 'b', createdAt: 2000 });
    clearDiary();
    expect(listEntries().length).toBe(0);
    expect(entryCount()).toBe(0);
  });
});

describe('diary — ordering', () => {
  it('listEntries sorts by createdAt ascending', () => {
    addEntry({ id: 'c1', text: 'c', createdAt: 3000 });
    addEntry({ id: 'a1', text: 'a', createdAt: 1000 });
    addEntry({ id: 'b1', text: 'b', createdAt: 2000 });
    expect(listEntries().map((e) => e.id)).toEqual(['a1', 'b1', 'c1']);
  });
});

describe('diary — copy is guilt-free and honest', () => {
  it('renderEmptyState has zero guilt phrases', () => {
    const text = renderEmptyState();
    expect(text.length).toBeGreaterThan(0);
    expect(auditForGuilt(text)).toEqual([]);
  });

  it('renderNotTherapistDisclosure names Tele-MANAS 14416 and is guilt-free', () => {
    const text = renderNotTherapistDisclosure();
    expect(text).toContain('not a therapist');
    expect(text).toContain('14416');
    expect(auditForGuilt(text)).toEqual([]);
  });
});

describe('diary — the guilt audit itself', () => {
  it('auditForGuilt flags known phrases and passes clean text', () => {
    expect(auditForGuilt('I missed you')).toContain('i missed you');
    expect(auditForGuilt("Don't leave")).toContain("don't leave");
    expect(auditForGuilt('This stays on this device.')).toEqual([]);
  });
});

describe('diary — source scan', () => {
  it('source scan: diary-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'diary-v2.ts'),
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