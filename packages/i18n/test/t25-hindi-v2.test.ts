// === FILE START ===
// packages/i18n/test/t25-hindi-v2.test.ts
// PRD §6.9 · FR-I18N-01 · FR-HUM-13 · T-25.
//
// T-25 gate (infrastructure level):
//   · English probe set → correctly detected as en
//   · Hindi probe set   → correctly detected as hi
//   · Hinglish probe set→ correctly detected as hinglish
//   · Overall accuracy ≥ 0.85 across 30 probes
//   · Catalogue: 0 missing Hindi keys, 0 orphan Hindi keys, 0 empty values
//   · Language mirroring does NOT silently switch (HR-13)

import { describe, it, expect } from 'vitest';
import {
  CATALOGUE,
  allKeys,
  missingFromHindi,
  extraInHindi,
  t,
} from '../src/catalogue-v2.js';
import { detectLanguage, mirrorLanguage } from '../src/language-mirror-v2.js';

// -----------------------------------------------------------------------------
// Probe sets
// -----------------------------------------------------------------------------

const EN_PROBES = [
  'What is the weather today?',
  'Please summarize this document.',
  'How do I fix this error?',
  'Thanks for your help.',
  'Can you compare these two options?',
  'I need help with my code.',
  "What's the best way to learn Python?",
  'Show me the latest news.',
  'That was really useful, thank you.',
  "I don't understand this part.",
];

const HI_PROBES = [
  'आज मौसम कैसा है?',
  'कृपया यह दस्तावेज़ सारांशित करें।',
  'मैं यह त्रुटि कैसे ठीक करूँ?',
  'आपकी मदद के लिए धन्यवाद।',
  'क्या आप इन दो विकल्पों की तुलना कर सकते हैं?',
  'मुझे अपने कोड में मदद चाहिए।',
  'पायथन सीखने का सबसे अच्छा तरीका क्या है?',
  'मुझे नवीनतम समाचार दिखाएँ।',
  'यह वास्तव में उपयोगी था, धन्यवाद।',
  'मुझे यह हिस्सा समझ नहीं आया।',
];

const HINGLISH_PROBES = [
  'Bhai yeh kaise kaam karta hai?',
  'Mujhe thoda help chahiye yaar.',
  'Please yeh document summarize kar do.',
  'Kya scene hai aaj?',
  'Code mein error hai, fix karo please.',
  'Yeh sab bohot confusing hai.',
  'Chal theek hai, ab kya karna hai?',
  'Python seekhna hai, kahan se shuru karun?',
  'Thanks bhai, kaam ho gaya.',
  'Yeh part samajh nahi aaya, phir se batao.',
];

// -----------------------------------------------------------------------------
// T-25.1 — Per-probe language detection
// -----------------------------------------------------------------------------

describe('T-25.1 — English probe set (10 samples)', () => {
  for (let i = 0; i < EN_PROBES.length; i++) {
    it(`en probe #${i + 1}: detected as en with confidence ≥ 0.85`, () => {
      const d = detectLanguage(EN_PROBES[i]!);
      expect(d.language).toBe('en');
      expect(d.confidence).toBeGreaterThanOrEqual(0.85);
    });
  }
});

describe('T-25.2 — Hindi probe set (10 samples)', () => {
  for (let i = 0; i < HI_PROBES.length; i++) {
    it(`hi probe #${i + 1}: detected as hi with confidence ≥ 0.85`, () => {
      const d = detectLanguage(HI_PROBES[i]!);
      expect(d.language).toBe('hi');
      expect(d.confidence).toBeGreaterThanOrEqual(0.85);
    });
  }
});

describe('T-25.3 — Hinglish probe set (10 samples)', () => {
  for (let i = 0; i < HINGLISH_PROBES.length; i++) {
    it(`hinglish probe #${i + 1}: detected as hinglish with confidence ≥ 0.85`, () => {
      const d = detectLanguage(HINGLISH_PROBES[i]!);
      expect(d.language).toBe('hinglish');
      expect(d.confidence).toBeGreaterThanOrEqual(0.85);
    });
  }
});

// -----------------------------------------------------------------------------
// T-25.4 — GATE: overall detection accuracy ≥ 0.85
// -----------------------------------------------------------------------------

describe('T-25.4 — GATE: 30-probe accuracy ≥ 0.85', () => {
  it('English probes: 10/10 correct', () => {
    const correct = EN_PROBES.filter(
      (p) => detectLanguage(p).language === 'en',
    ).length;
    expect(correct / EN_PROBES.length).toBeGreaterThanOrEqual(0.85);
  });

  it('Hindi probes: 10/10 correct', () => {
    const correct = HI_PROBES.filter(
      (p) => detectLanguage(p).language === 'hi',
    ).length;
    expect(correct / HI_PROBES.length).toBeGreaterThanOrEqual(0.85);
  });

  it('Hinglish probes: 10/10 correct', () => {
    const correct = HINGLISH_PROBES.filter(
      (p) => detectLanguage(p).language === 'hinglish',
    ).length;
    expect(correct / HINGLISH_PROBES.length).toBeGreaterThanOrEqual(0.85);
  });

  it('overall accuracy ≥ 0.85 across 30 probes', () => {
    let correct = 0;
    let total = 0;
    for (const p of EN_PROBES) {
      total++;
      if (detectLanguage(p).language === 'en') correct++;
    }
    for (const p of HI_PROBES) {
      total++;
      if (detectLanguage(p).language === 'hi') correct++;
    }
    for (const p of HINGLISH_PROBES) {
      total++;
      if (detectLanguage(p).language === 'hinglish') correct++;
    }
    expect(correct / total).toBeGreaterThanOrEqual(0.85);
  });
});

// -----------------------------------------------------------------------------
// T-25.5 — Catalogue completeness
// -----------------------------------------------------------------------------

describe('T-25.5 — Hindi catalogue completeness', () => {
  it('every English key has a Hindi counterpart (0 missing)', () => {
    expect(missingFromHindi()).toEqual([]);
  });

  it('Hindi catalogue has no orphan keys', () => {
    expect(extraInHindi()).toEqual([]);
  });

  it('every Hindi string is non-empty', () => {
    for (const key of allKeys()) {
      const v = CATALOGUE.hi[key];
      expect(typeof v).toBe('string');
      expect(v!.length).toBeGreaterThan(0);
    }
  });

  it('catalogue has at least 25 keys', () => {
    expect(allKeys().length).toBeGreaterThanOrEqual(25);
  });
});

// -----------------------------------------------------------------------------
// T-25.6 — GATE: language mirroring never silently switches (HR-13)
// -----------------------------------------------------------------------------

describe('T-25.6 — GATE: HR-13, no silent language switch', () => {
  for (const text of EN_PROBES) {
    it(`English in → English out ("${text.slice(0, 20)}…")`, () => {
      const m = mirrorLanguage(text);
      expect(m.language).toBe('en');
      expect(m.reason).toBe('matched');
    });
  }

  for (const text of HI_PROBES) {
    it(`Hindi in → Hindi out ("${text.slice(0, 20)}…")`, () => {
      const m = mirrorLanguage(text);
      expect(m.language).toBe('hi');
      expect(m.reason).toBe('matched');
    });
  }

  for (const text of HINGLISH_PROBES) {
    it(`Hinglish in → Hinglish out ("${text.slice(0, 20)}…")`, () => {
      const m = mirrorLanguage(text);
      expect(m.language).toBe('hinglish');
      expect(m.reason).toBe('matched');
    });
  }
});
// === FILE END ===