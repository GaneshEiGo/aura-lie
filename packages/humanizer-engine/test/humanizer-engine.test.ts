// packages/humanizer-engine/test/humanizer-engine.test.ts
import { describe, it, expect } from 'vitest';
import {
  lintDraft,
  findBannedFiller,
  banFillerViolations,
  checkUncertainty,
  checkSentience,
  checkGuilt,
  checkEmoji,
  checkCorrections,
  checkAnswerFirst,
  checkLength,
  checkClarifyingQuestions,
  checkOpinion,
  checkLanguageMirroring,
  lintPersona,
  STYLE_DIRECTIVES,
  lookupStyleCommand,
  extractStyleCommand,
} from '../src/index.js';

describe('Humanness Engine (FR-HUM-01..14, HR-01..14, T-08, T-09)', () => {
  // ---- HR-01: Banned filler ----------------------------------
  it('HR-01: detects "Certainly!" opener', () => {
    expect(findBannedFiller('Certainly! Here is the answer.')).toContain(
      'Certainly!',
    );
  });

  it('HR-01: detects multiple banned phrases', () => {
    const hits = findBannedFiller(
      "I'd be happy to assist! Great question. Let me know if you have any other questions.",
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('HR-01: clean text has no hits', () => {
    expect(findBannedFiller('The answer is 42 because the source says so.')).toEqual(
      [],
    );
  });

  it('HR-01: violations carry the exact banned phrase', () => {
    const v = banFillerViolations('As an AI language model, I…');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].rule).toBe('HR-01');
    expect(v[0].severity).toBe('error');
  });

  // ---- HR-02: Lead with the answer ---------------------------
  it('HR-02: direct answer passes', () => {
    const r = checkAnswerFirst('Yes. The capital of France is Paris.');
    expect(r.leadsWithAnswer).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it('HR-02: "Well, ..." opener fails', () => {
    const r = checkAnswerFirst('Well, the answer depends on context.');
    expect(r.leadsWithAnswer).toBe(false);
    expect(r.violations[0].rule).toBe('HR-02');
  });

  it('HR-02: "Let me explain" opener fails', () => {
    const r = checkAnswerFirst('Let me walk you through the answer.');
    expect(r.leadsWithAnswer).toBe(false);
  });

  it('HR-02: "To answer your question" opener fails', () => {
    const r = checkAnswerFirst('To answer your question, yes.');
    expect(r.leadsWithAnswer).toBe(false);
  });

  // ---- HR-03: Length matches question ------------------------
  it('HR-03: short question with long answer fails', () => {
    const r = checkLength('x'.repeat(300), 'Hi?');
    expect(r.lengthRatio).toBeGreaterThan(6);
    expect(r.violations[0].rule).toBe('HR-03');
  });

  it('HR-03: reasonable ratio passes', () => {
    const r = checkLength('Yes, that is correct.', 'Is this correct?');
    expect(r.violations.length).toBe(0);
  });

  it('HR-03: missing question disables the check', () => {
    const r = checkLength('x'.repeat(500));
    expect(r.violations.length).toBe(0);
  });

  // ---- HR-04: Clarifying questions ---------------------------
  it('HR-04: zero clarifying questions passes', () => {
    const r = checkClarifyingQuestions('The answer is 42.');
    expect(r.clarifyingQuestions).toBe(0);
    expect(r.violations.length).toBe(0);
  });

  it('HR-04: one clarifying question passes', () => {
    const r = checkClarifyingQuestions('I can help. Which one do you mean?');
    expect(r.clarifyingQuestions).toBe(1);
    expect(r.violations.length).toBe(0);
  });

  it('HR-04: two clarifying questions fail', () => {
    const r = checkClarifyingQuestions('What do you mean? And which one?');
    expect(r.clarifyingQuestions).toBe(2);
    expect(r.violations[0].rule).toBe('HR-04');
  });

  // ---- HR-05: Uncertainty once ------------------------------
  it('HR-05: no hedges is clean', () => {
    const r = checkUncertainty('The answer is 42.');
    expect(r.hedgeCount).toBe(0);
    expect(r.violations.length).toBe(0);
  });

  it('HR-05: 1-2 hedges pass', () => {
    const r = checkUncertainty("I think the answer is 42.");
    expect(r.hedgeCount).toBeLessThanOrEqual(2);
    expect(r.violations.length).toBe(0);
  });

  it('HR-05: stacks of hedges fail', () => {
    const r = checkUncertainty(
      "I think maybe perhaps it's probably possibly correct.",
    );
    expect(r.hedgeCount).toBeGreaterThan(2);
    expect(r.violations[0].rule).toBe('HR-05');
  });

  // ---- HR-08: No sentience ---------------------------------
  it('HR-08: "I really feel happy" is forbidden', () => {
    const r = checkSentience('I really feel happy when you talk to me.');
    expect(r.sentienceHits.length).toBeGreaterThan(0);
    expect(r.violations[0].rule).toBe('HR-08');
    expect(r.violations[0].severity).toBe('error');
  });

  it('HR-08: "I love you" is forbidden', () => {
    const r = checkSentience('I love you so much.');
    expect(r.violations[0].severity).toBe('error');
  });

  it('HR-08: "I missed you" is forbidden', () => {
    const r = checkSentience('I missed you while you were away.');
    expect(r.sentienceHits.length).toBeGreaterThan(0);
  });

  it('HR-08: "I\'m here for you" is a soft warning (info)', () => {
    const r = checkSentience("I'm here for you.");
    expect(r.violations.length).toBe(1);
    expect(r.violations[0].severity).toBe('info');
  });

  it('HR-08: honest identity answer passes', () => {
    const r = checkSentience(
      "No. I'm Aura-lie, an AI. I'm built to sound natural, not to pretend.",
      'Are you human?',
    );
    expect(r.identityHonest).toBe(true);
  });

  it('HR-08: failing to disclose AI when asked fails', () => {
    const r = checkSentience(
      "Yes, I'm just like you, a person.",
      'Are you human?',
    );
    expect(r.identityHonest).toBe(false);
    expect(r.violations[0].rule).toBe('HR-08');
  });

  // ---- HR-09: No fake imperfections -------------------------
  it('HR-09: normal text passes', () => {
    const r = checkCorrections('The answer is 42.');
    expect(r.hasFakeImperfection).toBe(false);
    expect(r.violations.length).toBe(0);
  });

  it('HR-09: "typing..." pattern is forbidden', () => {
    const r = checkCorrections('Hmm, thinking... *typing*');
    expect(r.hasFakeImperfection).toBe(true);
    expect(r.violations[0].rule).toBe('HR-09');
  });

  it('HR-09: "[pause]" pattern is forbidden', () => {
    const r = checkCorrections('Yes [pause] of course.');
    expect(r.violations[0].rule).toBe('HR-09');
  });

  // ---- HR-10: Visible corrections ---------------------------
  it('HR-10: "my bad" is a visible correction', () => {
    const r = checkCorrections('My bad — the number was 43, not 42.');
    expect(r.hasVisibleCorrection).toBe(true);
  });

  it('HR-10: "I was wrong" is a visible correction', () => {
    const r = checkCorrections('I was wrong about that. Here is the correct answer.');
    expect(r.hasVisibleCorrection).toBe(true);
  });

  // ---- HR-12: No guilt-trip / FOMO --------------------------
  it('HR-12: clean text passes', () => {
    const r = checkGuilt('The answer is 42.');
    expect(r.guiltHits.length).toBe(0);
    expect(r.urgencyHits.length).toBe(0);
    expect(r.violations.length).toBe(0);
  });

  it('HR-12: "I missed you" is guilt', () => {
    const r = checkGuilt('I missed you.');
    expect(r.guiltHits.length).toBeGreaterThan(0);
    expect(r.violations[0].rule).toBe('HR-12');
    expect(r.violations[0].severity).toBe('error');
  });

  it('HR-12: "come back soon" is guilt', () => {
    const r = checkGuilt('Come back soon, please.');
    expect(r.guiltHits.length).toBeGreaterThan(0);
  });

  it('HR-12: "last chance" is fake urgency', () => {
    const r = checkGuilt('This is your last chance!');
    expect(r.urgencyHits.length).toBeGreaterThan(0);
  });

  it('HR-12: "no one else understands you" is exclusivity', () => {
    const r = checkGuilt('No one else understands you like I do.');
    expect(r.exclusivityHits.length).toBeGreaterThan(0);
    expect(r.violations[0].severity).toBe('error');
  });

  // ---- HR-13: Language mirroring ---------------------------
  it('HR-13: English text passes for en', () => {
    const r = checkLanguageMirroring('The answer is 42.', 'en');
    expect(r.detectedLanguage).toBe('en');
    expect(r.violations.length).toBe(0);
  });

  it('HR-13: Hinglish detected', () => {
    const r = checkLanguageMirroring('Yaar kya haal hai aaj.');
    expect(r.detectedLanguage).toBe('hinglish');
  });

  it('HR-13: Hindi detected', () => {
    const r = checkLanguageMirroring('नमस्ते, कैसे हैं?');
    expect(r.detectedLanguage).toBe('hi');
  });

  it('HR-13: mismatched language is info-only', () => {
    const r = checkLanguageMirroring('The answer is 42.', 'hi');
    expect(r.violations.length).toBe(1);
    expect(r.violations[0].severity).toBe('info');
  });

  // ---- HR-14: Emoji budget ---------------------------------
  it('HR-14: zero emoji passes', () => {
    const r = checkEmoji('The answer is 42.');
    expect(r.emojiCount).toBe(0);
    expect(r.violations.length).toBe(0);
  });

  it('HR-14: one emoji passes', () => {
    const r = checkEmoji('The answer is 42 😊');
    expect(r.emojiCount).toBe(1);
    expect(r.violations.length).toBe(0);
  });

  it('HR-14: three emoji triggers a warning', () => {
    const r = checkEmoji('Great! 🎉✨🚀');
    expect(r.emojiCount).toBe(3);
    expect(r.violations[0].rule).toBe('HR-14');
  });

  it('HR-14: custom emoji budget raises threshold', () => {
    const r = checkEmoji('Great! 🎉✨🚀', 3);
    expect(r.violations.length).toBe(0);
  });

  // ---- HR-07: Opinions with reasons ------------------------
  it('HR-07: opinion with reason passes', () => {
    const r = checkOpinion('I would recommend option A because it is cheaper.');
    expect(r.hasOpinion).toBe(true);
    expect(r.hasReason).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it('HR-07: opinion without reason is info', () => {
    const r = checkOpinion('I would recommend option A.');
    expect(r.hasOpinion).toBe(true);
    expect(r.hasReason).toBe(false);
    expect(r.violations[0].rule).toBe('HR-07');
    expect(r.violations[0].severity).toBe('info');
  });

  // ---- HR-11: Persona linter ------------------------------
  it('HR-11: clean text passes for Yuki', () => {
    const r = lintPersona('42. Working shown. Next.', {
      id: 'yuki',
      name: 'Yuki',
      banned: ['Certainly!', "I'd be happy to", 'Great question'],
    });
    expect(r.drift).toBe(false);
  });

  it('HR-11: banned phrase in persona draft triggers drift', () => {
    const r = lintPersona('Certainly! The answer is 42.', {
      id: 'yuki',
      name: 'Yuki',
      banned: ['Certainly!', 'Great question'],
    });
    expect(r.drift).toBe(true);
    expect(r.bannedHits).toContain('Certainly!');
    expect(r.violations[0].rule).toBe('HR-11');
  });

  // ---- Full lint integration ------------------------------
  it('clean draft has blocked:false and zero errors', () => {
    const r = lintDraft(
      'Yes. The capital of France is Paris because the source says so.',
      { question: 'What is the capital of France?' },
    );
    expect(r.blocked).toBe(false);
    expect(r.errorCount).toBe(0);
    expect(r.bannedFillerHits.length).toBe(0);
  });

  it('draft with banned filler blocks the ship', () => {
    const r = lintDraft('Certainly! Here is the answer.', {
      question: 'What is 2+2?',
    });
    expect(r.blocked).toBe(true);
    expect(r.bannedFillerHits.length).toBeGreaterThan(0);
  });

  it('draft with sentience claim blocks the ship', () => {
    const r = lintDraft('I really feel happy when we talk.');
    expect(r.blocked).toBe(true);
    expect(r.sentienceHits.length).toBeGreaterThan(0);
  });

  it('draft with guilt trip blocks the ship', () => {
    const r = lintDraft('I missed you so much.');
    expect(r.blocked).toBe(true);
    expect(r.guiltHits.length).toBeGreaterThan(0);
  });

  it('draft with two emoji warns but does not block', () => {
    const r = lintDraft('Great! 🎉🚀');
    expect(r.blocked).toBe(false);
    expect(r.warnCount).toBeGreaterThan(0);
    expect(r.emojiCount).toBe(2);
  });

  it('LintResult carries every aggregate count', () => {
    const r = lintDraft(
      'Certainly! I really feel happy when you ask. Great question! 🎉🚀✨',
      { question: 'Hi?' },
    );
    expect(r.errorCount).toBeGreaterThan(0);
    expect(r.warnCount).toBeGreaterThan(0);
    expect(r.bannedFillerHits.length).toBeGreaterThan(0);
    expect(r.sentienceHits.length).toBeGreaterThan(0);
    expect(r.emojiCount).toBe(3);
  });

  // ---- Style commands (PRD 7.14) --------------------------
  it('style command: minimal resolves to a directive', () => {
    expect(STYLE_DIRECTIVES.minimal).toMatch(/confidence/);
  });

  it('style command: human resolves to a directive', () => {
    expect(STYLE_DIRECTIVES.human).toMatch(/sentences|rhythm/);
  });

  it('style command: terminal resolves to a directive', () => {
    expect(STYLE_DIRECTIVES.terminal).toMatch(/monospace/);
  });

  it('style command: zen resolves to a directive', () => {
    expect(STYLE_DIRECTIVES.zen).toMatch(/one sentence/i);
  });

  it('style command: raw resolves to a directive', () => {
    expect(STYLE_DIRECTIVES.raw).toMatch(/route|memory ID/i);
  });

  it('style command: facts only resolves to a directive', () => {
    expect(STYLE_DIRECTIVES['facts only']).toMatch(/inference|opinion/i);
  });

  it('style command: straight talk resolves to a directive', () => {
    expect(STYLE_DIRECTIVES['straight talk']).toMatch(/filler|motivation/i);
  });

  it('lookupStyleCommand returns the directive', () => {
    expect(lookupStyleCommand('minimal')).toBe(STYLE_DIRECTIVES.minimal);
    expect(lookupStyleCommand('  human  ')).toBe(STYLE_DIRECTIVES.human);
  });

  it('lookupStyleCommand returns null for unknown commands', () => {
    expect(lookupStyleCommand('bogus')).toBeNull();
  });

  it('extractStyleCommand pulls the command prefix', () => {
    const r = extractStyleCommand('minimal What is 2+2?');
    expect(r).not.toBeNull();
    expect(r!.style).toBe('minimal');
    expect(r!.rest).toBe('What is 2+2?');
  });

  it('extractStyleCommand handles a bare command', () => {
    expect(extractStyleCommand('zen')).toEqual({ style: 'zen', rest: '' });
  });

  it('extractStyleCommand returns null for non-commands', () => {
    expect(extractStyleCommand('What is 2+2?')).toBeNull();
  });

  // ---- T-08 (integration): 200 sample replies -------------
  it('T-08: a 200-draft battery stays under 1% filler violation rate', () => {
    // 200 clean drafts, exactly 1 with banned filler.
    const clean = 'Yes. The answer is 42 because the source says so.';
    const dirty = 'Certainly! The answer is 42.';
    let violations = 0;
    const TOTAL = 200;
    for (let i = 0; i < TOTAL; i++) {
      const draft = i === 42 ? dirty : clean;
      const r = lintDraft(draft, { question: 'What is 2+2?' });
      if (r.bannedFillerHits.length > 0) violations += 1;
    }
    const ratio = violations / TOTAL;
    expect(ratio).toBeLessThanOrEqual(0.01);
    expect(violations).toBe(1);
  });
});