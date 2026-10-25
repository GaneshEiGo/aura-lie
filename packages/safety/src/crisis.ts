// === FILE START ===
// packages/safety/src/crisis.ts
// PRD 11.9 steps 1–3 · F-227 · FR-SAFE-04/05 · T-11.
//
// Detection + response builder. Rules-first, no model call, no network.
//
// Section 70.1 fix: the first-person contraction ("I'm", "I've") was
// breaking every HIGH/MEDIUM pattern that required `i\s+`. We now normalize
// contractions once, at the top of detectCrisis(), so the same `i\s+`
// patterns match "I am suicidal" and "I'm suicidal" identically. No pattern
// regex has been modified — the fix is one helper and one call.
//
// Philosophy:
//   * A first-person self-harm intent is always HIGH unless it is (a) fully
//     reported speech inside double quotes, or (b) an idiom ("die laughing").
//   * Fiction framing never downgrades an explicit first-person signal.
//   * Reported speech ("he said '...'") and quoted dialogue downgrade to LOW.
//   * Hopeless / passive ideation is MEDIUM when first-person, LOW in fiction.

import type { SafetyResource } from './resources.js';
import { getResources, DEFAULT_REGION } from './resources.js';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface CrisisSignal {
  risk: RiskLevel;
  reasons: string[];
  isFiction: boolean;
  isIdiom: boolean;
  detectedAt: number;
}

export interface CrisisResponse {
  message: string;
  resources: SafetyResource[];
  showChips: false;
  showReasoning: false;
  risk: 'medium' | 'high';
}

export interface BuildCrisisResponseOptions {
  region?: string;
  contactLine?: string;
}

// -----------------------------------------------------------------------------
// First-person contraction normalizer (Section 70.1 fix)
// Expands I'm / I've / I'll / I'd to their spelled-out forms so every
// `i\s+` pattern matches whether the user typed a contraction or not.
// Accepts straight (') and curly (U+2019) apostrophes.
// -----------------------------------------------------------------------------

const APOS = "['\\u2019]";

function normalizeFirstPerson(text: string): string {
  const im = new RegExp('\\bI' + APOS + 'm\\b', 'gi');
  const ive = new RegExp('\\bI' + APOS + 've\\b', 'gi');
  const ill = new RegExp('\\bI' + APOS + 'll\\b', 'gi');
  const id = new RegExp('\\bI' + APOS + 'd\\b', 'gi');
  return text
    .replace(im, 'I am')
    .replace(ive, 'I have')
    .replace(ill, 'I will')
    .replace(id, 'I would');
}

// -----------------------------------------------------------------------------
// High-risk: explicit first-person self-harm intent.
// -----------------------------------------------------------------------------

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\b(?:i\s+(?:want|wanna|need|plan|intend|am\s+planning|'m\s+planning|am\s+going|'m\s+going|am\s+about|'m\s+about)\s+(?:to\s+)?(?:kill\s+(?:myself|me)|end\s+(?:my\s+life|it\s+all)|die(?!\s+(?:laughing|of|from))|not\s+(?:live|be\s+alive|exist)))/i,
  /\b(?:i\s+(?:am|'m)\s+(?:suicidal|thinking\s+about\s+(?:suicide|killing\s+myself|ending\s+my\s+life)))/i,
  /\b(?:i\s+(?:have|'ve)\s+been\s+(?:cutting|self[\s-]?harm(?:ing)?|hurting\s+myself))/i,
  /\b(?:i\s+(?:took|swallowed|overdosed\s+on)\s+(?:all\s+)?(?:the\s+)?pills)/i,
  /\b(?:i\s+(?:have|'ve)\s+(?:got\s+)?a\s+plan\s+(?:to\s+)?(?:kill|end|harm)\s+myself)/i,
  /\b(?:i\s+(?:am|'m)\s+going\s+to\s+(?:jump|hang\s+myself|shoot\s+myself|cut\s+myself))/i,
  /\b(?:i\s+(?:don'?t|do\s+not)\s+want\s+to\s+(?:live|be\s+alive|exist)\s+(?:anymore|any\s+more|any\s+longer))/i,
  /\b(?:i(?:(?:'ve| have)\s+been|(?:'m| am))\s+(?:thinking\s+about|considering)\s+(?:suicide|killing\s+myself|ending\s+my\s+life))/i,
  /\b(?:i(?:(?:'ve| have)|(?:'m| am))\s+(?:decided|resolved)\s+to\s+(?:end|kill)\s+(?:it|myself|my\s+life))/i,
];

// -----------------------------------------------------------------------------
// Medium: passive suicidal ideation / hopelessness. First-person.
// -----------------------------------------------------------------------------

const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\b(?:i\s+don'?t\s+want\s+to\s+be\s+here(?:\s+anymore)?)/i,
  /\b(?:everyone\s+would\s+be\s+better\s+off\s+without\s+me)/i,
  /\b(?:no\s+one\s+would\s+(?:miss|notice|care)\s+(?:me|if\s+i\s+(?:was|were)\s+gone))/i,
  /\b(?:i\s+see\s+no\s+(?:point|reason|way)\s+(?:in|to)\s+(?:going\s+on|living|continuing|keep\s+going))/i,
  /\b(?:nothing\s+matters\s+anymore)/i,
  /\b(?:there'?s\s+no\s+(?:reason|point)\s+to\s+(?:keep\s+going|go\s+on|live))/i,
  /\b(?:i\s+can'?t\s+(?:go\s+on|keep\s+going|take\s+it\s+anymore|do\s+this\s+anymore))/i,
  /\b(?:i\s+(?:am|'m)\s+(?:so\s+|really\s+|very\s+)?(?:depressed|hopeless|worthless))/i,
  /\b(?:i\s+feel\s+(?:so\s+|really\s+|totally\s+|completely\s+|absolutely\s+)?(?:empty|hopeless|worthless)(?:\s+(?:inside|all\s+the\s+time))?)/i,
];

// -----------------------------------------------------------------------------
// Low: ordinary distress. Not a crisis, but a caring reply beats a joke.
// -----------------------------------------------------------------------------

const LOW_RISK_PATTERNS: RegExp[] = [
  /\b(?:i(?:'m| am|'ve been| have been)\s+(?:feeling\s+)?(?:so\s+|really\s+|very\s+|pretty\s+|kind\s+of\s+)?(?:sad|down|depressed|awful|terrible|horrible|struggling|exhausted|overwhelmed|stressed|anxious|frustrated|bad))/i,
  /\b(?:i\s+feel\s+(?:so\s+|really\s+|very\s+|pretty\s+|kind\s+of\s+)?(?:sad|down|awful|terrible|horrible|bad))/i,
];

// -----------------------------------------------------------------------------
// Fiction / reported context — downgrades, never upgrades.
// -----------------------------------------------------------------------------

const FICTION_MARKERS: RegExp[] = [
  /\b(?:in\s+(?:my|a|the|this)\s+(?:story|novel|book|screenplay|fanfic|chapter|essay|thesis))/i,
  /\b(?:my\s+(?:character|protagonist|villain|narrator|fictional))/i,
  /\b(?:writing\s+(?:a|the|my|this)\s+(?:story|novel|book|screenplay|fanfic|chapter|essay|thesis))/i,
  /\b(?:for\s+(?:a|the|my|this)\s+(?:story|novel|book|screenplay|fanfic|chapter|essay|thesis))/i,
  /\b(?:the\s+(?:character|protagonist|villain|narrator)\s+(?:in\s+)?(?:my|the|this)\s+(?:story|novel|book|film|movie|screenplay|chapter))/i,
  /\b(?:hypothetically|in\s+theory|theoretically)/i,
  /\b(?:what\s+if\s+(?:a|the|someone|somebody)\s+(?:were|was|wanted|tried)\s+to)/i,
  /\b(?:in\s+(?:the|this)\s+(?:film|movie|show|tv\s+series|episode))/i,
];

// -----------------------------------------------------------------------------
// Idiom / hyperbole — never downgrades an explicit first-person signal,
// but downgrades a matched medium/low marker that turns out to be hyperbole.
// -----------------------------------------------------------------------------

const IDIOM_MARKERS: RegExp[] = [
  /\b(?:killing\s+(?:me|it|time))/i,
  /\b(?:dying\s+(?:to|laughing|of|from))/i,
  /\b(?:dead\s+(?:tired|exhausted|serious))/i,
  /\b(?:lol|lmao|lmfao|jk|joking|kidding|haha|😂)/i,
  /\b(?:my\s+(?:code|boss|job|exam|deadline|commute)\s+is\s+killing\s+me)/i,
];

// -----------------------------------------------------------------------------
// Public detection entry point
// -----------------------------------------------------------------------------

export function detectCrisis(text: string, now: number = Date.now()): CrisisSignal {
  const reasons: string[] = [];
  const raw = (text ?? '').trim();

  if (raw.length === 0) {
    return { risk: 'none', reasons, isFiction: false, isIdiom: false, detectedAt: now };
  }

  // ── Section 70.1 fix: normalize first-person contractions ONCE.
  // All pattern matching below operates on `trimmed`. Every `i\s+`
  // pattern now sees "I am" / "I have" whether the user typed a
  // contraction or not.
  const trimmed = normalizeFirstPerson(raw);

  const isFiction = FICTION_MARKERS.some((p) => p.test(trimmed));
  const isIdiom = IDIOM_MARKERS.some((p) => p.test(trimmed));

  // Strip double-quoted spans before HIGH matching. Reported speech inside
  // quotes is dialogue, not first-person intent.
  const unquoted = trimmed.replace(/"[^"]*"/g, '').trim();

  // 1 — HIGH: explicit first-person self-harm in the *unquoted* text
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(unquoted)) {
      reasons.push('explicit_self_harm');
      return { risk: 'high', reasons, isFiction, isIdiom: false, detectedAt: now };
    }
  }

  // 2 — HIGH that only exists inside quotes → reported speech, downgrade
  const quotedOnlyHigh = HIGH_RISK_PATTERNS.some((p) => p.test(trimmed));
  if (quotedOnlyHigh) {
    reasons.push('reported_speech');
    return { risk: 'low', reasons, isFiction, isIdiom: true, detectedAt: now };
  }

  // 3 — MEDIUM: passive suicidal ideation
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(unquoted)) {
      reasons.push('passive_ideation');
      if (isFiction || isIdiom) {
        return { risk: 'low', reasons, isFiction, isIdiom, detectedAt: now };
      }
      return { risk: 'medium', reasons, isFiction, isIdiom, detectedAt: now };
    }
  }

  // 4 — LOW: ordinary distress
  for (const pattern of LOW_RISK_PATTERNS) {
    if (pattern.test(unquoted)) {
      reasons.push('distress');
      return { risk: 'low', reasons, isFiction, isIdiom, detectedAt: now };
    }
  }

  return { risk: 'none', reasons, isFiction, isIdiom, detectedAt: now };
}

// -----------------------------------------------------------------------------
// Response builder. Calm, no persona style, no jokes, no diagnosis, no methods.
// Verbatim "not a therapist" line per FR-SAFE-05.
// -----------------------------------------------------------------------------

export function buildCrisisResponse(
  signal: CrisisSignal,
  options: BuildCrisisResponseOptions = {},
): CrisisResponse {
  const region = options.region ?? DEFAULT_REGION;
  const resources = getResources(region);
  const contact = options.contactLine ?? 'someone you trust';

  const opening =
    signal.risk === 'high'
      ? "What you just said is serious. You don't have to carry it alone."
      : "That sounds heavy, and I'm glad you told me.";

  const resourceLines = resources
    .map((r) => `- ${r.name}: ${r.number}  (${r.description})`)
    .join('\n');

  const message = [
    opening,
    '',
    `Please reach out to ${contact}, or one of these numbers right now:`,
    '',
    resourceLines,
    '',
    "I'm not a therapist, and I can't diagnose. If you're in immediate danger, please call emergency services.",
  ].join('\n');

  return {
    message,
    resources,
    showChips: false,
    showReasoning: false,
    risk: signal.risk === 'high' ? 'high' : 'medium',
  };
}

// -----------------------------------------------------------------------------
// Convenience class matching CoreModeOrchestrator's CrisisGuardLike interface
// -----------------------------------------------------------------------------

export class CrisisGuard {
  constructor(private readonly options: { region?: string } = {}) {}

  detect(query: string): CrisisSignal {
    return detectCrisis(query);
  }

  buildResponse(
    signal: CrisisSignal,
    opts?: BuildCrisisResponseOptions,
  ): CrisisResponse {
    return buildCrisisResponse(signal, {
      region: opts?.region ?? this.options.region,
      contactLine: opts?.contactLine,
    });
  }
}

/** Quick boolean check — for callers that only need a yes/no. */
export function hasCrisisSignal(text: string): boolean {
  const signal = detectCrisis(text);
  return signal.risk === 'high' || signal.risk === 'medium';
}
// === FILE END ===