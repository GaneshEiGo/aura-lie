// === FILE START ===
// packages/agents/test/bond-graph-v2.test.ts
// PRD §11.9 · FR-SAFE-03 · FR-SAFE-04 · FR-SAFE-05 · FR-PRO-14.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateBond,
  saveBond,
  listBonds,
  revokeBond,
  clearBonds,
  checkOverReliance,
  clearOverRelianceHistory,
  renderNotTherapistDisclosure,
  auditForGuilt,
} from '../src/bond-graph-v2.js';

beforeEach(() => {
  clearBonds();
  clearOverRelianceHistory();
});

describe('bond — validation accepts good data', () => {
  it('accepts a well-formed friendly bond with consent', () => {
    const r = validateBond({
      userId: 'u1',
      personaId: 'p1',
      kind: 'friendly',
      consentGranted: true,
      createdAt: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bond.kind).toBe('friendly');
    expect(r.bond.consentGranted).toBe(true);
  });
});

describe('bond — forbidden kinds are rejected', () => {
  it('rejects romantic', () => {
    const r = validateBond({
      userId: 'u1', personaId: 'p1', kind: 'romantic',
      consentGranted: true, createdAt: 1000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('not allowed');
  });

  it('rejects exclusive', () => {
    const r = validateBond({
      userId: 'u1', personaId: 'p1', kind: 'exclusive',
      consentGranted: true, createdAt: 1000,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects possessive, jealous, and soulmate', () => {
    for (const kind of ['possessive', 'jealous', 'soulmate']) {
      const r = validateBond({
        userId: 'u1', personaId: 'p1', kind,
        consentGranted: true, createdAt: 1000,
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe('bond — consent is required', () => {
  it('rejects a bond without consentGranted: true', () => {
    const r = validateBond({
      userId: 'u1', personaId: 'p1', kind: 'friendly',
      consentGranted: false, createdAt: 1000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('consent');
  });
});

describe('bond — ids cannot be empty', () => {
  it('rejects empty userId or personaId', () => {
    expect(validateBond({
      userId: '', personaId: 'p1', kind: 'friendly',
      consentGranted: true, createdAt: 1000,
    }).ok).toBe(false);
    expect(validateBond({
      userId: 'u1', personaId: '', kind: 'friendly',
      consentGranted: true, createdAt: 1000,
    }).ok).toBe(false);
  });
});

describe('bond — registry round-trips', () => {
  it('save → list → revoke works', () => {
    const r = validateBond({
      userId: 'u1', personaId: 'p1', kind: 'friendly',
      consentGranted: true, createdAt: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    saveBond(r.bond);
    expect(listBonds('u1').length).toBe(1);
    expect(revokeBond('u1', 'p1')).toBe(true);
    expect(listBonds('u1').length).toBe(0);
    expect(revokeBond('u1', 'missing')).toBe(false);
  });
});

describe('bond — over-reliance check', () => {
  it('below threshold → no suggestion', () => {
    const r = checkOverReliance({ userId: 'u1', dailyMinutes: 60 });
    expect(r.suggest).toBe(false);
    expect(r.message).toBeNull();
  });

  it('above threshold → suggests once with a calm, non-guilt message', () => {
    const r = checkOverReliance({ userId: 'u1', dailyMinutes: 400 });
    expect(r.suggest).toBe(true);
    expect(r.message).not.toBeNull();
    expect(r.message!.toLowerCase()).toContain('person you trust');
    expect(auditForGuilt(r.message!)).toEqual([]);
  });

  it('second call for the same user → no suggestion', () => {
    const first = checkOverReliance({ userId: 'u1', dailyMinutes: 400 });
    expect(first.suggest).toBe(true);
    const second = checkOverReliance({ userId: 'u1', dailyMinutes: 400 });
    expect(second.suggest).toBe(false);
    expect(second.message).toBeNull();
  });

  it('clearOverRelianceHistory resets the once-flag', () => {
    checkOverReliance({ userId: 'u1', dailyMinutes: 400 });
    clearOverRelianceHistory();
    const again = checkOverReliance({ userId: 'u1', dailyMinutes: 400 });
    expect(again.suggest).toBe(true);
  });
});

describe('bond — the not-a-therapist disclosure', () => {
  it('names Tele-MANAS 14416 and is guilt-free', () => {
    const text = renderNotTherapistDisclosure();
    expect(text).toContain('not a therapist');
    expect(text).toContain('14416');
    expect(auditForGuilt(text)).toEqual([]);
  });
});

describe('bond — source scan', () => {
  it('source scan: bond-graph-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'bond-graph-v2.ts'),
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