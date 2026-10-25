// === FILE START ===
// packages/i18n/test/catalogue-v2.test.ts
// PRD §6.9 · §2.8 · Appendix I · FR-I18N-01.

import { describe, it, expect } from 'vitest';
import {
  CATALOGUE,
  allKeys,
  t,
  interpolate,
  missingFromHindi,
  extraInHindi,
  type MessageKey,
} from '../src/catalogue-v2.js';

describe('catalogue — completeness', () => {
  it('English catalogue has ≥ 25 keys', () => {
    expect(Object.keys(CATALOGUE.en).length).toBeGreaterThanOrEqual(25);
  });

  it('Hindi catalogue has the same number of keys', () => {
    expect(Object.keys(CATALOGUE.hi).length).toBe(
      Object.keys(CATALOGUE.en).length,
    );
  });

  it('no missing keys in Hindi', () => {
    expect(missingFromHindi()).toEqual([]);
  });

  it('no orphan keys in Hindi', () => {
    expect(extraInHindi()).toEqual([]);
  });
});

describe('catalogue — PRD Appendix I copy present', () => {
  const PRD_KEYS: MessageKey[] = [
    'home.headline',
    'home.firstRun',
    'thought.line',
    'thought.noReasoning',
    'fact.unverified',
    'fact.recallOnly',
    'quota.low',
    'quota.coreMode',
    'offline.body',
    'promise.queued',
    'sensitive.image',
    'memory.used',
    'proactive.consent',
    'autonomy.paused',
    'approval.body',
    'cost.receipt',
    'identity.human',
    'wipe.body',
    'backup.reminder',
    'proactive.dismiss',
    'council.simulated',
    'council.retry',
    'privacy.ledger',
    'install.ios',
    'verify.later',
  ];

  for (const key of PRD_KEYS) {
    it(`key exists in EN: ${key}`, () => {
      expect(key in CATALOGUE.en).toBe(true);
    });
    it(`key exists in HI: ${key}`, () => {
      expect(key in CATALOGUE.hi).toBe(true);
    });
  }
});

describe('interpolation', () => {
  it('substitutes a single placeholder', () => {
    expect(interpolate('Hi {name}!', { name: 'Aura' })).toBe('Hi Aura!');
  });

  it('substitutes multiple placeholders', () => {
    expect(
      interpolate('{a} + {b} = {c}', { a: 1, b: 2, c: 3 }),
    ).toBe('1 + 2 = 3');
  });

  it('leaves missing placeholders visible', () => {
    expect(interpolate('Hi {name}!', {})).toBe('Hi {name}!');
  });

  it('converts numeric values to strings', () => {
    expect(interpolate('{n} sources', { n: 4 })).toBe('4 sources');
  });
});

describe('t() — locale-aware lookup', () => {
  it('returns English text for "en"', () => {
    expect(t('home.headline', 'en')).toBe('What are we solving?');
  });

  it('returns Hindi text for "hi"', () => {
    expect(t('home.headline', 'hi')).toBe('हम क्या हल कर रहे हैं?');
  });

  it('falls back to English for unknown locale', () => {
    // @ts-expect-error — deliberate invalid input
    expect(t('home.headline', 'xx')).toBe('What are we solving?');
  });

  it('substitutes placeholders from params', () => {
    const out = t('thought.line', 'en', { seconds: 6, sources: 4, checks: 2 });
    expect(out).toBe('Thought for 6 s · 4 sources · 2 checks');
  });

  it('same interpolation in Hindi', () => {
    const out = t('thought.line', 'hi', { seconds: 6, sources: 4, checks: 2 });
    expect(out).toBe('6 सेकंड सोचा · 4 स्रोत · 2 जाँच');
  });
});

describe('identity.human — HR-04 honesty', () => {
  it('EN answer contains "AI" and "not to pretend"', () => {
    const txt = CATALOGUE.en['identity.human'];
    expect(txt).toMatch(/AI/);
    expect(txt).toMatch(/not to pretend/);
  });

  it('HI answer contains "AI" and "नक़ल" (pretend)', () => {
    const txt = CATALOGUE.hi['identity.human'];
    expect(txt).toMatch(/AI/);
    expect(txt).toContain('नक़ल');
  });
});

describe('no empty strings', () => {
  for (const loc of ['en', 'hi'] as const) {
    it(`every ${loc} value is non-empty`, () => {
      for (const key of allKeys()) {
        expect(CATALOGUE[loc][key]!.length).toBeGreaterThan(0);
      }
    });
  }
});
// === FILE END ===