// === FILE START ===
// packages/personas/test/roster-v2.test.ts
// PRD §11.3 · D-19.

import { describe, it, expect } from 'vitest';
import {
  ROSTER,
  SLIDER_KEYS,
  findPersona,
  validatePersona,
  PersonaSchemaError,
  AURA_LIE,
  YUKI,
  KIRA,
  NOVA,
  KAITO,
  RIN,
  SORA,
  MIKO,
  MOMO,
  VECTOR,
} from '../src/personas-roster-v2.js';

describe('roster — the ten', () => {
  it('has exactly 10 personas', () => {
    expect(ROSTER.length).toBe(10);
  });

  it('contains exactly the PRD §11.3 roster', () => {
    const ids = ROSTER.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        'aura-lie', 'yuki', 'kira', 'nova', 'kaito',
        'rin', 'sora', 'miko', 'momo', 'vector',
      ].sort(),
    );
  });

  it('Aura-lie is the chair', () => {
    expect(AURA_LIE.council_role).toBe('chair');
  });

  it('each archetype persona has the expected council role', () => {
    expect(YUKI.council_role).toBe('numbers');
    expect(KIRA.council_role).toBe('technical');
    expect(NOVA.council_role).toBe('facts');
    expect(KAITO.council_role).toBe('red-team');
    expect(RIN.council_role).toBe('possibilities');
    expect(SORA.council_role).toBe('perspective');
    expect(MIKO.council_role).toBe('learning');
    expect(MOMO.council_role).toBe('comfort');
    expect(VECTOR.council_role).toBe('specs');
  });
});

describe('roster — schema', () => {
  it('SLIDER_KEYS is exactly the ten sliders', () => {
    expect([...SLIDER_KEYS].sort()).toEqual(
      [
        'warmth', 'humor', 'energy', 'skepticism', 'bluntness',
        'formality', 'verbosity', 'creativity', 'emoji', 'sarcasm',
      ].sort(),
    );
  });

  it('every persona has all 10 sliders in [0, 1]', () => {
    for (const p of ROSTER) {
      for (const k of SLIDER_KEYS) {
        expect(typeof p.sliders[k]).toBe('number');
        expect(p.sliders[k]).toBeGreaterThanOrEqual(0);
        expect(p.sliders[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every persona passes validatePersona()', () => {
    for (const p of ROSTER) {
      expect(() => validatePersona(p)).not.toThrow();
    }
  });

  it('validatePersona rejects an out-of-range slider', () => {
    const bad = {
      ...YUKI,
      sliders: { ...YUKI.sliders, warmth: 1.5 },
    };
    expect(() => validatePersona(bad)).toThrow(PersonaSchemaError);
  });

  it('validatePersona rejects an empty rules list', () => {
    const bad = { ...YUKI, rules: [] };
    expect(() => validatePersona(bad)).toThrow(PersonaSchemaError);
  });
});

describe('roster — lookup', () => {
  it('findPersona finds every roster id', () => {
    for (const p of ROSTER) {
      expect(findPersona(p.id)?.id).toBe(p.id);
    }
  });

  it('findPersona returns null for unknown ids', () => {
    expect(findPersona('nope')).toBeNull();
  });
});

describe('roster — banned phrases per persona', () => {
  it('every persona has a banned list (may be empty)', () => {
    for (const p of ROSTER) {
      expect(Array.isArray(p.banned)).toBe(true);
    }
  });

  it('Aura-lie banned includes filler', () => {
    expect(AURA_LIE.banned.some((b) => /certainly/i.test(b))).toBe(true);
  });
});
// === FILE END ===