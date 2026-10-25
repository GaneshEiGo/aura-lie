// === FILE START ===
// packages/i18n/src/language-mirror-v2.ts
// PRD §11.8 · FR-HUM-13 · HR-13.
//
// Detect the language of a user message and decide what language the reply
// should be in. HR-13 forbids silent language switches: a Hindi user who
// types in Hindi gets a Hindi reply, a Hinglish user stays Hinglish, an
// English user stays English.
//
// Detection signals:
//   1. Devanagari characters present          → hi or hinglish
//   2. Latin only, with Hinglish marker ratio ≥ 0.15 → hinglish
//   3. Latin only, no markers                 → en
//   4. Neither script                         → other

export type Language = 'en' | 'hi' | 'hinglish' | 'other';

export interface DetectionResult {
  language: Language;
  /** 0..1. Confidence in the detected language. */
  confidence: number;
  /** Which Hinglish markers (if any) were found. */
  markers: string[];
  hasDevanagari: boolean;
  hasLatin: boolean;
  wordCount: number;
}

// Common Romanized Hindi words. Deliberately excludes ambiguous Latin tokens
// like "hi", "ha", "the", "to", "tab" (browser tab). See Section 95 doc.
const HINGLISH_MARKERS: ReadonlySet<string> = new Set([
  'kya', 'kyun', 'kaise', 'kaun', 'kab', 'kahan',
  'hai', 'hain', 'hoga', 'hogi', 'honge',
  'nahi', 'nahin',
  'bhai', 'yaar', 'behen',
  'acha', 'accha', 'achha', 'theek', 'thik',
  'matlab', 'matalab',
  'karo', 'karna', 'karke', 'kiya', 'kiye',
  'kuch', 'bohot', 'bahut', 'thoda', 'thodi',
  'mera', 'meri', 'mere', 'tera', 'teri', 'tere',
  'hum', 'tum', 'aap', 'woh', 'yeh',
  'raha', 'rahi', 'rahe', 'tha', 'thi',
  'sakta', 'sakti', 'sakte',
  'jahan', 'vahan',
  'bolo', 'batao', 'bata', 'suno', 'dekho', 'dekh',
  'jao', 'aao',
  'ab', 'jab',
  'sahi', 'galat', 'acchi',
  'bilkul', 'zaroor', 'zarurat',
  'chal', 'chalega', 'chalta', 'chalti',
  'gaya', 'gayi', 'gaye',
  'padega', 'padegi', 'padenge',
  'seekhna', 'seekha', 'seekhi',
  'samajh', 'samjha', 'samjhi',
  'padho', 'padha', 'padhi',
  'likho', 'likha', 'likhi',
  'karte', 'karta', 'karti',
  'waise', 'wala', 'wali', 'wale',
  'abhi', 'pehle', 'baad', 'phir',
  'haan', 'ji',
  'kaafi',
  'shukriya', 'dhanyavaad',
]);

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const LATIN_RE = /[A-Za-z]/;

export function detectLanguage(text: string): DetectionResult {
  const trimmed = (text ?? '').trim();
  const hasDevanagari = DEVANAGARI_RE.test(trimmed);
  const hasLatin = LATIN_RE.test(trimmed);

  const words = trimmed
    .toLowerCase()
    .split(/[^a-z\u0900-\u097F]+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;

  const markers = Array.from(
    new Set(words.filter((w) => HINGLISH_MARKERS.has(w))),
  );

  if (!hasDevanagari && !hasLatin) {
    return {
      language: 'other',
      confidence: wordCount === 0 ? 0 : 0.5,
      markers,
      hasDevanagari,
      hasLatin,
      wordCount,
    };
  }

  if (hasDevanagari && hasLatin) {
    return {
      language: 'hinglish',
      confidence: 0.92,
      markers,
      hasDevanagari,
      hasLatin,
      wordCount,
    };
  }

  if (hasDevanagari) {
    return {
      language: 'hi',
      confidence: 0.99,
      markers,
      hasDevanagari,
      hasLatin,
      wordCount,
    };
  }

  // Latin only
  const ratio = wordCount === 0 ? 0 : markers.length / wordCount;
  if (ratio >= 0.15) {
    const confidence = 0.85 + Math.min(ratio, 0.5) * 0.1;
    return {
      language: 'hinglish',
      confidence: Math.min(0.95, confidence),
      markers,
      hasDevanagari,
      hasLatin,
      wordCount,
    };
  }

  return {
    language: 'en',
    confidence: markers.length === 0 ? 0.95 : 0.85,
    markers,
    hasDevanagari,
    hasLatin,
    wordCount,
  };
}

export type MirrorReason = 'matched' | 'preserved' | 'defaulted';

export interface MirrorOptions {
  /** Language to fall back to when detection is uncertain. Default: 'en'. */
  defaultLanguage?: Language;
  /** If true, preserve the previous conversation language on low confidence. */
  previousLanguage?: Language;
  /** Minimum confidence to accept the detected language. Default: 0.5. */
  minConfidence?: number;
}

export interface MirrorDecision {
  language: Language;
  confidence: number;
  reason: MirrorReason;
  markers: string[];
}

/**
 * Decide the reply language. NEVER silently switches: if the user typed in
 * Hindi, the reply stays Hindi; Hinglish stays Hinglish; English stays
 * English. `reason` distinguishes matched (same as input) from preserved
 * (used a low-confidence fallback) from defaulted (no signal).
 */
export function mirrorLanguage(
  userText: string,
  options: MirrorOptions = {},
): MirrorDecision {
  const det = detectLanguage(userText);
  const minConf = options.minConfidence ?? 0.5;

  if (det.confidence >= minConf && det.language !== 'other') {
    return {
      language: det.language,
      confidence: det.confidence,
      reason: 'matched',
      markers: det.markers,
    };
  }

  if (options.previousLanguage && options.previousLanguage !== 'other') {
    return {
      language: options.previousLanguage,
      confidence: det.confidence,
      reason: 'preserved',
      markers: det.markers,
    };
  }

  const fallback = options.defaultLanguage ?? 'en';
  return {
    language: fallback,
    confidence: det.confidence,
    reason: 'defaulted',
    markers: det.markers,
  };
}
// === FILE END ===