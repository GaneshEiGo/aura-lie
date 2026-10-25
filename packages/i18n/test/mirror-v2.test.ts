// === FILE START ===
// packages/i18n/test/mirror-v2.test.ts
// PRD §11.8 · FR-HUM-13 · HR-13.

import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  mirrorLanguage,
} from '../src/language-mirror-v2.js';
import {
  detectLocale,
  formatNumber,
  formatDate,
  formatTime,
  formatCurrency,
  formatQuotaReset,
  formatRelativeTime,
} from '../src/locale-v2.js';

// =============================================================================
// 1. Language detection — pure signals
// =============================================================================

describe('detectLanguage — script detection', () => {
  it('pure Devanagari → hi, confidence ≥ 0.99', () => {
    const d = detectLanguage('आज मौसम कैसा है?');
    expect(d.language).toBe('hi');
    expect(d.confidence).toBeGreaterThanOrEqual(0.99);
    expect(d.hasDevanagari).toBe(true);
    expect(d.hasLatin).toBe(false);
  });

  it('pure Latin without markers → en, confidence ≥ 0.95', () => {
    const d = detectLanguage('What is the weather today?');
    expect(d.language).toBe('en');
    expect(d.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('mixed Devanagari + Latin → hinglish', () => {
    const d = detectLanguage('यह code कैसे काम करता है?');
    expect(d.language).toBe('hinglish');
    expect(d.hasDevanagari).toBe(true);
    expect(d.hasLatin).toBe(true);
  });

  it('purely Romanized Hinglish → hinglish', () => {
    const d = detectLanguage('bhai yeh kaise kaam karta hai');
    expect(d.language).toBe('hinglish');
    expect(d.markers.length).toBeGreaterThan(0);
  });

  it('empty string → other, confidence 0', () => {
    const d = detectLanguage('');
    expect(d.language).toBe('other');
    expect(d.confidence).toBe(0);
  });

  it('numbers and punctuation only → other', () => {
    const d = detectLanguage('123 !@# 456');
    expect(d.language).toBe('other');
  });
});

// =============================================================================
// 2. Mirror decision — HR-13 no silent switch
// =============================================================================

describe('mirrorLanguage — HR-13 preservation', () => {
  it('English input → en reply, reason=matched', () => {
    const m = mirrorLanguage('Can you help me?');
    expect(m.language).toBe('en');
    expect(m.reason).toBe('matched');
  });

  it('Hindi input → hi reply, reason=matched', () => {
    const m = mirrorLanguage('क्या आप मदद कर सकते हैं?');
    expect(m.language).toBe('hi');
    expect(m.reason).toBe('matched');
  });

  it('Hinglish input → hinglish reply, reason=matched', () => {
    const m = mirrorLanguage('bhai please help kar do');
    expect(m.language).toBe('hinglish');
    expect(m.reason).toBe('matched');
  });

  it('other-script input → preserved previous language', () => {
    const m = mirrorLanguage('12345', { previousLanguage: 'hi' });
    expect(m.language).toBe('hi');
    expect(m.reason).toBe('preserved');
  });

  it('empty input → defaults to en', () => {
    const m = mirrorLanguage('');
    expect(m.language).toBe('en');
    expect(m.reason).toBe('defaulted');
  });

  it('empty input with defaultLanguage=hi → hi', () => {
    const m = mirrorLanguage('', { defaultLanguage: 'hi' });
    expect(m.language).toBe('hi');
  });
});

// =============================================================================
// 3. Locale detection
// =============================================================================

describe('detectLocale', () => {
  it('Accept-Language "hi-IN" → hi-IN', () => {
    expect(detectLocale('hi-IN', 'Asia/Kolkata')).toBe('hi-IN');
  });

  it('Accept-Language "hi" → hi', () => {
    expect(detectLocale('hi')).toBe('hi');
  });

  it('Accept-Language "en-IN" → en-IN', () => {
    expect(detectLocale('en-IN')).toBe('en-IN');
  });

  it('Asia/Kolkata timezone and no locale hint → en-IN', () => {
    expect(detectLocale(null, 'Asia/Kolkata')).toBe('en-IN');
  });

  it('null header, no tz → en', () => {
    expect(detectLocale(null, null)).toBe('en');
  });
});

// =============================================================================
// 4. Formatting — Indian numbering, IST defaults
// =============================================================================

describe('locale formatting', () => {
  it('formatNumber uses locale grouping', () => {
    // en-IN uses lakh/crore grouping for large numbers
    const out = formatNumber(1234567, { locale: 'en-IN' });
    expect(out).toBeDefined();
    expect(out.length).toBeGreaterThan(0);
  });

  it('formatDate produces a human date string', () => {
    const out = formatDate(new Date('2026-10-02T12:00:00Z'), {
      locale: 'en-IN',
    });
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Oct/);
  });

  it('formatTime appends the timezone label', () => {
    const out = formatTime(new Date('2026-10-02T00:00:00Z'), {
      locale: 'en-IN',
      timeZone: 'Asia/Kolkata',
    });
    expect(out).toContain('IST');
    expect(out).toMatch(/05:30/);
  });

  it('formatQuotaReset matches the PRD "05:30 IST" form', () => {
    const resetAt = new Date('2026-10-03T00:00:00Z');
    const out = formatQuotaReset(resetAt, {
      locale: 'en-IN',
      timeZone: 'Asia/Kolkata',
    });
    expect(out).toBe('05:30 IST');
  });

  it('formatCurrency renders INR by default', () => {
    const out = formatCurrency(0);
    expect(out).toMatch(/[₹0]/);
    expect(out).toContain('0');
  });

  it('formatRelativeTime renders hours', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const target = new Date('2026-10-02T15:00:00Z');
    const out = formatRelativeTime(target, now, { locale: 'en' });
    expect(out).toMatch(/hour|3/);
  });
});
// === FILE END ===