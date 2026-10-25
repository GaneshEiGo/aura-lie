// === FILE START ===
// packages/security/src/sensitivity.ts
// PRD 12.3 · F-226 · S0/S1/S2 classification.
//
// Section 71.2 fix (one bug, two patterns):
//   * credential:bearer — was `/\bBearer\s+TOKEN{20,}/i`, which required the
//     token to appear IMMEDIATELY after "Bearer". Real inputs often have
//     "bearer token is ..." or "bearer jwt: ..." in between. New pattern:
//     `/\bbearer\b[\s\S]{0,40}?TOKEN{16,}/i` — allows up to 40 intervening
//     chars before the token.
//   * credential:jwt — was `/\beyJ[A-Za-z0-9_\-]{20,}/`. A well-formed JWT
//     like `eyJhbGciOiJIUzI1NiJ9` is exactly 20 chars total (eyJ + 17), so
//     it failed the `{20,}` threshold. New: `{10,}`.
//
// Preserves every export from Section 71.1 so `security.test.ts` (13 tests)
// and all other callers stay green:
//   * classify, classifyWithReason, isPrivate
//   * classifySensitivity (positional-privacyZones alias)
//   * SensitivityViolation, validateLaneAccess (lane guards)

export type Sensitivity = 'S0' | 'S1' | 'S2';

export interface ClassificationOptions {
  /** User-marked privacy zones. Any match forces S2. */
  privacyZones?: string[];
}

export interface ClassificationResult {
  class: Sensitivity;
  reasons: string[];
  matcher: 'rule' | 'zone' | 'default';
}

/** Back-compat error type used by `validateLaneAccess`. */
export class SensitivityViolation extends Error {
  constructor(
    public readonly sensitivity: Sensitivity,
    public readonly lane: string,
  ) {
    super(`Sensitivity ${sensitivity} is not allowed in ${lane} lane`);
    this.name = 'SensitivityViolation';
  }
}

// -----------------------------------------------------------------------------
// S2 patterns
// -----------------------------------------------------------------------------

const S2_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Credentials
  { name: 'credential:password', pattern: /\b(?:password|passcode|passphrase|pwd)s?\b/i },
  { name: 'credential:api-key', pattern: /\b(?:api[_\s-]?(?:key|secret)|secret[_\s-]?key|access[_\s-]?token|private[_\s-]?key)s?\b/i },
  { name: 'credential:sk-prefix', pattern: /\b(?:sk[-_]|pk_|ghp_|AKIA)[A-Za-z0-9_\-]{16,}/ },
  // Section 71.2 fix — allow intervening words between "bearer" and the token
  { name: 'credential:bearer', pattern: /\bbearer\b[\s\S]{0,40}?[A-Za-z0-9_\-\.]{16,}/i },
  // Section 71.2 fix — lower suffix threshold so short JWTs match
  { name: 'credential:jwt', pattern: /\beyJ[A-Za-z0-9_\-]{10,}/ },
  { name: 'credential:otp', pattern: /\b(?:otp|one[-\s]?time\s+(?:code|password))\s*(?:is|:)?\s*\d{4,8}\b/i },
  { name: 'credential:card-info', pattern: /\b(?:card\s+(?:pin|number)|cvv|cvc|expiry\s+date)\b/i },
  { name: 'credential:pem', pattern: /-----BEGIN\s+(?:[A-Z]+\s+)?(?:PRIVATE|PUBLIC|RSA|EC|OPENSSH)\s+KEY-----/ },

  // Health
  { name: 'health:medical', pattern: /\b(?:medical|diagnos(?:is|es|ed)|prescriptions?|hospitals?|surger(?:y|ies)|treatments?|doctors?(?:'s)?\s+visits?)\b/i },
  { name: 'health:condition', pattern: /\b(?:cancers?|diabetes|diabetic|hiv|aids|hypertension|asthma|arthritis|epilepsy|autoimmune|migraines?|headaches?)\b/i },
  { name: 'health:medication', pattern: /\b(?:medications?|medicines?|dose|dosage|tablets?|insulin|chemotherapy|inhalers?|epipen|statins?)\b/i },
  { name: 'health:mental', pattern: /\b(?:depression|depressed|anxiety|anxious|panic\s+attacks?|ptsd|bipolar|schizophreni[ac]|ocd|adhd)\b/i },
  { name: 'health:therapy', pattern: /\b(?:therapists?|therap(?:y|ies)|psychiatr(?:ist|y|ists)|psycholog(?:ist|y|ists)|counsel(?:lor|ling|lors)|rehab)\b/i },
  { name: 'health:disability', pattern: /\b(?:disabilit(?:y|ies)|disabled|handicap|wheelchair|chronic\s+(?:pain|illness|condition|fatigue|migraines?|headaches?))\b/i },
  { name: 'health:vitals', pattern: /\b(?:blood\s+(?:pressure|sugar)|cholesterol|heart\s+rate|pulse)\b/i },
  { name: 'health:imaging', pattern: /\b(?:mri|ct\s+scans?|x-rays?|ultrasounds?|ecg|ekg)\b/i },

  // Money
  { name: 'money:salary', pattern: /\b(?:salary|salaries|income|earnings|paycheck|take[-\s]?home(?:\s+(?:pay|salary))?|ctc|gross\s+pay|net\s+pay)\b/i },
  { name: 'money:debt', pattern: /\b(?:debts?|loans?|mortgages?|credit\s+cards?|emi|installments?|overdraft|outstanding)\b/i },
  { name: 'money:savings', pattern: /\b(?:savings|bank\s+balance|net\s+worth|investment\s+(?:portfolio|account)|401k|ppf|nps|mutual\s+funds?|stock\s+portfolios?)\b/i },
  { name: 'money:identifier', pattern: /\b(?:pan|aadhaar|aadhar|ssn|social\s+security|routing\s+number|ifsc|upi\s+id|bank\s+account)\b/i },
  { name: 'money:amount', pattern: /(?:₹|rs\.?\s*\d|usd\s*\d|\$\s*\d|\d+\s*(?:lakh|crore|cr\b)|\d+\s*k\s+per\s+(?:month|annum)|\d+\s*(?:lpa))/i },

  // Relationships
  { name: 'relationships:divorce', pattern: /\b(?:divorces?|separat(?:ed|ing)|custody\s+(?:battle|dispute)|alimony|prenup)\b/i },
  { name: 'relationships:partner', pattern: /\bmy\s+(?:wife|husband|spouse|partner|girlfriend|boyfriend|ex(?:[-\s]\w+)?|fianc[ée]?)\b/i },
  { name: 'relationships:conflict', pattern: /\b(?:abusive|abuse|cheat(?:ed|ing)|break\s*up|broken\s+up|fighting\s+with\s+my)\b/i },
  { name: 'relationships:loss', pattern: /\b(?:passed\s+away|died|death\s+of\s+my|funeral|grieving)\b/i },

  // Minors
  { name: 'minors:child', pattern: /\b(?:my\s+(?:child|kid|son|daughter|baby|toddler|teen(?:ager)?)|my\s+\d+[-\s]year[-\s]old)\b/i },
  { name: 'minors:minor', pattern: /\b(?:minor\s+child|under\s+18|under\s+eighteen)\b/i },
  { name: 'minors:school', pattern: /\bmy\s+(?:child|kid|son|daughter)'?s?\s+(?:school|teacher|class|grade)\b/i },

  // Mental state
  { name: 'mental:crisis', pattern: /\b(?:suicid(?:e|al)|self[-\s]?harm|kill\s+myself|end\s+my\s+life|want\s+to\s+die)\b/i },
  { name: 'mental:distress', pattern: /\b(?:hopeless|worthless|can'?t\s+go\s+on|no\s+reason\s+to\s+live|see\s+no\s+point)\b/i },
  { name: 'mental:trauma', pattern: /\b(?:trauma|flashback|abuse(?:d)?\s+me|assaulted|molested)\b/i },

  // Legal
  { name: 'legal:court', pattern: /\b(?:court\s+(?:case|hearing|order|summons)|lawsuits?|legal\s+(?:case|matter|advice|counsel)|subpoena|fir|bail|hearings?)\b/i },
  { name: 'legal:sued', pattern: /\b(?:being\s+sued|sue[sd]|suing)\b/i },
  { name: 'legal:arrest', pattern: /\barrest(?:ed|s)?\b/i },
  { name: 'legal:criminal', pattern: /\b(?:criminal\s+record|convicted|felony|misdemeanor|probation|parole|evict(?:ed|ion))\b/i },
  { name: 'legal:lawyer', pattern: /\bmy\s+(?:lawyer|attorney|advocate)\b/i },
];

// -----------------------------------------------------------------------------
// S1 patterns
// -----------------------------------------------------------------------------

const S1_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'personal:im-verbing', pattern: /\bi(?:'m| am)\s+\w+ing\b/i },
  { name: 'personal:ive-verbed', pattern: /\bi(?:'ve| have)\s+\w+ed\b/i },
  { name: 'personal:i-prefer', pattern: /\bi\s+(?:prefer|like|love|hate|dislike|enjoy|usually|always|never|often|sometimes|want|need)\b/i },
  { name: 'personal:i-verb', pattern: /\bi\s+(?:live|work|study|learn|read|cook|run|go|come|stay|grew\s+up|was\s+born|grew|take)\b/i },
  {
    name: 'personal:my-noun',
    pattern: /\bmy\s+(?:\w+\s+)?(?:name|age|job|role|boss|team|company|course|degree|class|project|startup|thesis|draft|goal|objective|target|plan|favorite|favourite|country|city|hometown|colleague|manager|mentor|mentee|intern|client|user|customer|book|read|app|website|commit|code|repo|algorithm|sprint|task|backlog|story|issue|bug|pr|merge|review|build|deploy|test|script|function|feature|api|endpoint|database|query|schema|model|data)\b/i,
  },
  { name: 'personal:planning', pattern: /\bi(?:'m| am)\s+(?:planning|going\s+to|thinking\s+about|considering)\b/i },
  { name: 'personal:will-verb', pattern: /\bi(?:'ll| will)\s+\w+/i },
  { name: 'personal:i-plan', pattern: /\bi\s+plan\b/i },
  { name: 'personal:im-capitalized-name', pattern: /\bi(?:'m| am)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/ },
  { name: 'personal:call-me', pattern: /\bcall\s+me\s+[A-Z]/i },
  { name: 'personal:age', pattern: /\bi(?:'m| am)\s+\d{1,3}(?:\s*years)?\s*old\b/i },
  { name: 'personal:im-from', pattern: /\bi(?:'m| am)\s+from\s+[A-Z][a-z]+/i },
  { name: 'personal:moved-to', pattern: /\bi\s+moved\s+to\s+[A-Z][a-z]+/i },
  { name: 'personal:wake-up', pattern: /\bi\s+(?:wake|get)\s+up\b/i },
  { name: 'personal:stuck', pattern: /\bi(?:'m| am)\s+stuck\b/i },
  { name: 'personal:code-review', pattern: /\bcode\s+review\b/i },
  { name: 'personal:side-project', pattern: /\bside\s+project\b/i },
];

// -----------------------------------------------------------------------------
// Public entry points
// -----------------------------------------------------------------------------

export function classify(
  text: string,
  options: ClassificationOptions = {},
): Sensitivity {
  return classifyWithReason(text, options).class;
}

/** Back-compat alias used by the original `security.test.ts` (positional args). */
export function classifySensitivity(
  text: string,
  privacyZones?: string[],
): Sensitivity {
  return classify(text, { privacyZones });
}

export function classifyWithReason(
  text: string,
  options: ClassificationOptions = {},
): ClassificationResult {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) {
    return { class: 'S0', reasons: [], matcher: 'default' };
  }

  // 1 — privacy zones (highest priority)
  if (options.privacyZones && options.privacyZones.length > 0) {
    const lower = trimmed.toLowerCase();
    for (const zone of options.privacyZones) {
      if (zone && lower.includes(zone.toLowerCase())) {
        return {
          class: 'S2',
          reasons: [`privacy_zone:${zone}`],
          matcher: 'zone',
        };
      }
    }
  }

  // 2 — S2 patterns
  const s2Reasons: string[] = [];
  for (const { name, pattern } of S2_PATTERNS) {
    if (pattern.test(trimmed)) s2Reasons.push(name);
  }
  if (s2Reasons.length > 0) {
    return { class: 'S2', reasons: s2Reasons, matcher: 'rule' };
  }

  // 3 — S1 patterns
  const s1Reasons: string[] = [];
  for (const { name, pattern } of S1_PATTERNS) {
    if (pattern.test(trimmed)) s1Reasons.push(name);
  }
  if (s1Reasons.length > 0) {
    return { class: 'S1', reasons: s1Reasons, matcher: 'rule' };
  }

  // 4 — default
  return { class: 'S0', reasons: [], matcher: 'default' };
}

/** Convenience: true when the text would classify as S2. */
export function isPrivate(text: string, options: ClassificationOptions = {}): boolean {
  return classify(text, options) === 'S2';
}

/** Back-compat lane guard used by the original `security.test.ts`. */
export function validateLaneAccess(sensitivity: Sensitivity, lane: string): void {
  if (sensitivity === 'S2' && lane === 'training-risk') {
    throw new SensitivityViolation(sensitivity, lane);
  }
}
// === FILE END ===