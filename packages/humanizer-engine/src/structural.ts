// packages/humanizer-engine/src/structural.ts
// HR-02, HR-03, HR-04, HR-06, HR-07, HR-13: structural checks on the draft.

import type { Violation } from './types.js';

// ---- HR-02: lead with the answer -----------------------------------------
const NON_ANSWER_OPENERS: RegExp[] = [
  /^I\s+(?:think|believe|feel)\b/i,
  /^Let\s+me\s+(?:explain|start|walk\s+you\s+through)\b/i,
  /^To\s+(?:answer|address)\s+(?:that|your\s+question)\b/i,
  /^Well,?\s+/i,
  /^Okay,?\s+so\b/i,
  /^Sure,?\s+/i,
];

export interface AnswerFirstResult {
  leadsWithAnswer: boolean;
  violations: Violation[];
}

export function checkAnswerFirst(text: string): AnswerFirstResult {
  const violations: Violation[] = [];
  if (!text) return { leadsWithAnswer: false, violations };

  const firstSentence = text.split(/[.!?](?:\s|$)/)[0]?.trim() ?? '';
  if (!firstSentence) {
    return { leadsWithAnswer: false, violations };
  }

  const startsWithBanned = NON_ANSWER_OPENERS.some((re) =>
    re.test(firstSentence),
  );

  if (startsWithBanned) {
    violations.push({
      rule: 'HR-02',
      severity: 'warn',
      message: 'First sentence does not lead with the answer (HR-02)',
      excerpt: firstSentence.slice(0, 80),
    });
    return { leadsWithAnswer: false, violations };
  }

  return { leadsWithAnswer: true, violations };
}

// ---- HR-03: length matches the question ---------------------------------
export interface LengthResult {
  lengthRatio: number;
  violations: Violation[];
}

export function checkLength(text: string, question?: string): LengthResult {
  if (!question || !question.trim()) {
    return { lengthRatio: 1, violations: [] };
  }
  const qLen = question.trim().length;
  const aLen = text.trim().length;
  if (qLen === 0) return { lengthRatio: 1, violations: [] };
  const ratio = aLen / qLen;

  const violations: Violation[] = [];
  // Short question (< 40 chars) with long answer (> 6×) = padded.
  if (qLen < 40 && ratio > 6) {
    violations.push({
      rule: 'HR-03',
      severity: 'warn',
      message: `Short question (${qLen} chars) got a long answer (${aLen} chars, ${ratio.toFixed(1)}×)`,
    });
  }
  return { lengthRatio: ratio, violations };
}

// ---- HR-04: at most one clarifying question -----------------------------
export interface ClarifyingResult {
  clarifyingQuestions: number;
  violations: Violation[];
}

export function checkClarifyingQuestions(text: string): ClarifyingResult {
  const violations: Violation[] = [];
  if (!text) return { clarifyingQuestions: 0, violations };

  // A "clarifying question" is a question mark used in the middle of the
  // answer where the model asks the user for more info. We approximate by
  // counting "?" occurrences and flag if more than 1.
  const questionMarks = (text.match(/\?/g) ?? []).length;
  const clarifyingQuestions = questionMarks;

  if (clarifyingQuestions > 1) {
    violations.push({
      rule: 'HR-04',
      severity: 'warn',
      message: `Asked ${clarifyingQuestions} questions; HR-04 allows at most 1`,
    });
  }
  return { clarifyingQuestions, violations };
}

// ---- HR-06: memory callbacks (structural only) --------------------------
const MEMORY_CALLBACK_PATTERNS: RegExp[] = [
  /\byou\s+(?:mentioned|said|told\s+me)\b/i,
  /\blast\s+(?:Tuesday|week|month|time)\s+you\b/i,
  /\b(?:earlier|previously)\s+you\b/i,
];

export interface MemoryCallbackResult {
  hasCallback: boolean;
  violations: Violation[];
}

export function checkMemoryCallbacks(text: string): MemoryCallbackResult {
  const violations: Violation[] = [];
  if (!text) return { hasCallback: false, violations };
  const hasCallback = MEMORY_CALLBACK_PATTERNS.some((re) => re.test(text));
  // HR-06 requires any callback to be sourced (from a memory entry). The
  // sourcing check happens at the pipeline level — here we only flag.
  return { hasCallback, violations };
}

// ---- HR-07: opinions with reasons ---------------------------------------
const OPINION_MARKERS: RegExp[] = [
  /\bI\s+(?:would|'d)\s+(?:recommend|choose|prefer|suggest)\b/i,
  /\bthe\s+better\s+(?:option|choice|approach)\s+is\b/i,
  /\bI\s+think\s+the\s+(?:best|right|wrong)\b/i,
];

const REASON_MARKERS: RegExp[] = [
  /\bbecause\b/i,
  /\bsince\b/i,
  /\bdue\s+to\b/i,
  /\bfor\s+(?:this|that)\s+reason\b/i,
  /\bthe\s+reason\s+(?:is|being)\b/i,
];

export interface OpinionResult {
  hasOpinion: boolean;
  hasReason: boolean;
  violations: Violation[];
}

export function checkOpinion(text: string): OpinionResult {
  const violations: Violation[] = [];
  if (!text) return { hasOpinion: false, hasReason: false, violations };

  const hasOpinion = OPINION_MARKERS.some((re) => re.test(text));
  if (!hasOpinion) return { hasOpinion: false, hasReason: false, violations };

  const hasReason = REASON_MARKERS.some((re) => re.test(text));
  if (!hasReason) {
    violations.push({
      rule: 'HR-07',
      severity: 'info',
      message: 'Opinion presented without a stated reason (HR-07)',
    });
  }
  return { hasOpinion, hasReason, violations };
}

// ---- HR-13: language mirroring ------------------------------------------
const HINGLISH_MARKERS: RegExp[] = [
  /\b(?:yaar|bhai|kya|hai|nahi|haan|accha|theek|matlab)\b/i,
];
const DEVANAGARI_RE = /[\u0900-\u097F]/;

export interface LanguageResult {
  detectedLanguage: 'en' | 'hi' | 'hinglish' | 'other';
  violations: Violation[];
}

export function checkLanguageMirroring(
  text: string,
  requestedLanguage?: 'en' | 'hi' | 'hinglish' | 'other',
): LanguageResult {
  const violations: Violation[] = [];
  if (!text) return { detectedLanguage: 'en', violations };

  let detected: 'en' | 'hi' | 'hinglish' | 'other' = 'en';
  if (DEVANAGARI_RE.test(text)) detected = 'hi';
  else if (HINGLISH_MARKERS.some((re) => re.test(text))) detected = 'hinglish';

  if (requestedLanguage && requestedLanguage !== 'other') {
    if (requestedLanguage !== detected) {
      violations.push({
        rule: 'HR-13',
        severity: 'info',
        message: `Detected ${detected} but user requested ${requestedLanguage}`,
      });
    }
  }
  return { detectedLanguage: detected, violations };
}