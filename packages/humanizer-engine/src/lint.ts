// packages/humanizer-engine/src/lint.ts
// The one entry point. T-08: "HR-01 to HR-14 on a sample of 200 replies."

import type {
  LintOptions,
  LintResult,
  Violation,
} from './types.js';
import { findBannedFiller, banFillerViolations } from './banned-filler.js';
import { checkUncertainty } from './uncertainty.js';
import { checkSentience } from './sentience.js';
import { checkGuilt } from './guilt.js';
import { checkEmoji } from './emoji.js';
import { checkCorrections } from './corrections.js';
import {
  checkAnswerFirst,
  checkLength,
  checkClarifyingQuestions,
  checkOpinion,
  checkLanguageMirroring,
} from './structural.js';

export function lintDraft(text: string, options: LintOptions = {}): LintResult {
  const allViolations: Violation[] = [];

  // HR-01
  const bannedFillerHits = findBannedFiller(text);
  allViolations.push(...banFillerViolations(text));

  // HR-02
  const answer = checkAnswerFirst(text);
  allViolations.push(...answer.violations);

  // HR-03
  const length = checkLength(text, options.question);
  allViolations.push(...length.violations);

  // HR-04
  const clarifying = checkClarifyingQuestions(text);
  allViolations.push(...clarifying.violations);

  // HR-05
  const uncertainty = checkUncertainty(text);
  allViolations.push(...uncertainty.violations);

  // HR-07
  const opinion = checkOpinion(text);
  allViolations.push(...opinion.violations);

  // HR-08 (uses the question for the identity-honesty sub-rule)
  const sentience = checkSentience(text, options.question);
  allViolations.push(...sentience.violations);

  // HR-09 + HR-10
  const corrections = checkCorrections(text);
  allViolations.push(...corrections.violations);

  // HR-12
  const guilt = checkGuilt(text);
  allViolations.push(...guilt.violations);

  // HR-13
  const language = checkLanguageMirroring(text, options.language);
  allViolations.push(...language.violations);

  // HR-14
  const emojiBudget = options.emojiBudget ?? 1;
  const emoji = checkEmoji(text, emojiBudget);
  allViolations.push(...emoji.violations);

  const errorCount = allViolations.filter(
    (v) => v.severity === 'error',
  ).length;
  const warnCount = allViolations.filter(
    (v) => v.severity === 'warn',
  ).length;
  const infoCount = allViolations.filter(
    (v) => v.severity === 'info',
  ).length;

  return {
    blocked: errorCount > 0,
    violations: allViolations,
    errorCount,
    warnCount,
    infoCount,
    bannedFillerHits,
    sentienceHits: sentience.sentienceHits,
    guiltHits: guilt.guiltHits,
    emojiCount: emoji.emojiCount,
    leadsWithAnswer: answer.leadsWithAnswer,
    lengthRatio: length.lengthRatio,
    clarifyingQuestions: clarifying.clarifyingQuestions,
  };
}