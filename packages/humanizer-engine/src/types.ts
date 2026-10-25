// packages/humanizer-engine/src/types.ts
// PRD 11.5 (HR-01..HR-14), 7.14 (style commands), T-08.

export type HumannessRule =
  | 'HR-01'
  | 'HR-02'
  | 'HR-03'
  | 'HR-04'
  | 'HR-05'
  | 'HR-06'
  | 'HR-07'
  | 'HR-08'
  | 'HR-09'
  | 'HR-10'
  | 'HR-11'
  | 'HR-12'
  | 'HR-13'
  | 'HR-14';

export type Severity = 'error' | 'warn' | 'info';

export interface Violation {
  rule: HumannessRule;
  severity: Severity;
  message: string;
  /** Byte offset or character index of the offending span. */
  at?: number;
  /** Snippet from the offending text — capped at 80 chars. */
  excerpt?: string;
}

export type StyleCommand =
  | 'minimal'
  | 'human'
  | 'terminal'
  | 'zen'
  | 'raw'
  | 'facts only'
  | 'straight talk';

export interface LintOptions {
  /** The user's original question (for HR-03 length matching). */
  question?: string;
  /** The persona's language mirroring target. */
  language?: 'en' | 'hi' | 'hinglish' | 'other';
  /** Whether the mode allows emoji (Rin persona raises this). */
  emojiBudget?: number;
  /** Style command that alters expected format. */
  style?: StyleCommand;
}

export interface LintResult {
  /** When true, the caller MUST NOT ship this draft. */
  blocked: boolean;
  /** Aggregate list of every violation. Empty when the draft is clean. */
  violations: Violation[];
  /** Convenience counters. */
  errorCount: number;
  warnCount: number;
  infoCount: number;
  /** HR-01: banned filler phrases that triggered the re-draft. */
  bannedFillerHits: string[];
  /** HR-08: sentience claims detected. */
  sentienceHits: string[];
  /** HR-12: guilt/fomo phrasing detected. */
  guiltHits: string[];
  /** HR-14: emoji count. */
  emojiCount: number;
  /** HR-02: whether the first sentence is a valid answer lead. */
  leadsWithAnswer: boolean;
  /** HR-03: length ratio vs question length (0..n). */
  lengthRatio: number;
  /** HR-04: how many clarifying questions were asked. */
  clarifyingQuestions: number;
}

export const BANNED_FILLER_STARTER = [
  'Certainly!',
  'Certainly,',
  "I'd be happy to",
  'Absolutely!',
  'Absolutely,',
  'Great question',
  'As an AI language model',
  'As an AI',
  'I hope this helps',
  'Here is a comprehensive overview',
  "Let me know if you have any other questions",
] as const;