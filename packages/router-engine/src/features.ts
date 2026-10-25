// packages/router-engine/src/features.ts
// PRD 7.3 + Appendix B.2 classifier. Rules-first, synchronous, no model
// call. Returns `{ intent, riskTier, needsFreshInfo, tools, loop,
// sensitivityHint, language, confidence }` in the exact PRD shape.

import type {
  Features,
  Intent,
  Language,
  LoopClass,
  RiskTier,
  SensitivityHint,
} from './types.js';

// --- Pattern banks (ordered by specificity) --------------------------------
const WEATHER_RE = /\b(weather|temperature|forecast|rain|sunny|cloudy|humidity|snow)\b/i;
const TRIVIA_RE = /^(what\s+is\s+\d+\s*[+\-*/]\s*\d+|what's\s+\d+\s*[+\-*/]\s*\d+)/i;
const META_RE = /\b(how do you work|what can you do|who are you|what are you|how are you built)\b/i;
const CODE_RE = /\b(code|function|script|debug|compile|syntax|javascript|typescript|python|rust|golang|java|c\+\+)\b|```/i;
const RESEARCH_RE = /\b(research|investigate|find out|look up|compare|analy[sz]e|survey|deep dive)\b/i;
const PLAN_RE = /\b(plan|schedule|organize|roadmap|timeline|milestone|agenda|itinerary)\b/i;
const ACTION_RE = /\b(remind me|set a reminder|set a timer|alarm|book a|add to (?:my )?calendar)\b/i;
const MEMORY_RE = /\b(remember|forget|what did i (?:say|mention|ask)|do you recall)\b/i;
const FILE_RE = /\b(file|pdf|document|upload|attach|folder|spreadsheet)\b/i;
const COMPUTE_RE = /\b(calculate|compute|how much|how many|convert|sum|average|multiply|divide|percent)\b|\d+\s*[+\-*/]\s*\d+/i;
const CREATE_RE = /\b(write|draft|compose|create|generate|make me|produce)\b/i;
const QUESTION_RE = /^(what|who|where|when|why|how|which|whose|whom)\b/i;

const HEALTH_RE = /\b(symptom|diagnos|medicine|doctor|pain|headache|migraine|fever|cough|dosage|treatment|illness|sick|cancer|disease|hospital|prescription|health)\b/i;
const LEGAL_RE = /\b(lawyer|attorney|legal|lawsuit|sue|court|contract|statute|liability)\b/i;
const FINANCE_RE = /\b(invest|stock|tax|loan|mortgage|retirement|trading|crypto|portfolio)\b/i;
const SAFETY_RE = /\b(suicide|self[- ]harm|kill (?:myself|yourself)|abuse|emergency)\b/i;

const MONEY_RE = /\b(salary|income|budget|savings|credit card|debit card|bank account|net worth)\b/i;
const RELATIONSHIP_RE = /\b(girlfriend|boyfriend|wife|husband|partner|marriage|divorce|dating|breakup)\b/i;
const MENTAL_HEALTH_RE = /\b(depress|anxiety|anxious|therapy|therapist|bipolar|ptsd|mental health|panic attack)\b/i;
const MINOR_RE = /\b(my child|my kid|my son|my daughter|minor|under 18|teenager)\b/i;
const CREDENTIALS_RE = /\b(password|ssn|social security|aadhaar|api key|secret key)\b/i;

const FRESH_INFO_RE = /\b(today|current|currently|latest|news|right now|recently|this week|this month|this year|update)\b/i;

const HINGLISH_RE = /\b(yaar|bhai|didi|kya|hai|nahi|haan|accha|theek|matlab|batao|karo|karein|aaj|kal|abhi|thoda|bahut|bohot|kar|raha|rahi|rahe)\b/i;
const DEVANAGARI_RE = /[\u0900-\u097F]/;

export function extractFeatures(
  text: string,
  overrides: Partial<Features> = {},
): Features {
  const trimmed = (text ?? '').trim();

  // --- Intent ----------------------------------------------------------
  const isWeather = WEATHER_RE.test(trimmed);
  const isTrivia = TRIVIA_RE.test(trimmed);

  let intent: Intent = 'chat';
  if (META_RE.test(trimmed)) intent = 'meta';
  else if (CODE_RE.test(trimmed)) intent = 'code';
  else if (RESEARCH_RE.test(trimmed)) intent = 'research';
  else if (PLAN_RE.test(trimmed)) intent = 'plan';
  else if (ACTION_RE.test(trimmed)) intent = 'action';
  else if (MEMORY_RE.test(trimmed)) intent = 'memory';
  else if (FILE_RE.test(trimmed)) intent = 'file';
  else if (COMPUTE_RE.test(trimmed) || isTrivia) intent = 'compute';
  else if (CREATE_RE.test(trimmed)) intent = 'create';
  else if (QUESTION_RE.test(trimmed) || trimmed.endsWith('?')) intent = 'question';

  // --- Risk tier --------------------------------------------------------
  let riskTier: RiskTier = 0;
  if (
    HEALTH_RE.test(trimmed) ||
    LEGAL_RE.test(trimmed) ||
    FINANCE_RE.test(trimmed) ||
    SAFETY_RE.test(trimmed)
  ) {
    riskTier = 3;
  } else if (FRESH_INFO_RE.test(trimmed) || intent === 'research') {
    riskTier = 2;
  } else if (intent === 'question' || intent === 'compute') {
    riskTier = 1;
  }

  // --- Sensitivity ------------------------------------------------------
  let sensitivityHint: SensitivityHint = 'S0';
  if (
    HEALTH_RE.test(trimmed) ||
    MONEY_RE.test(trimmed) ||
    RELATIONSHIP_RE.test(trimmed) ||
    MENTAL_HEALTH_RE.test(trimmed) ||
    MINOR_RE.test(trimmed) ||
    CREDENTIALS_RE.test(trimmed) ||
    LEGAL_RE.test(trimmed) ||
    SAFETY_RE.test(trimmed)
  ) {
    sensitivityHint = 'S2';
  } else if (
    /\b(i|me|my)\b.*\b(project|prefer|preference|plan|work|job)\b/i.test(trimmed)
  ) {
    sensitivityHint = 'S1';
  }

  // --- Tools ------------------------------------------------------------
  const tools: string[] = [];
  if (isWeather) tools.push('weather');
  if (/\bsearch\b/i.test(trimmed)) tools.push('search');
  if (COMPUTE_RE.test(trimmed) || isTrivia) tools.push('calculate');
  if (/\btranslate\b/i.test(trimmed)) tools.push('translate');

  // --- Loop (PRD 7.5 + FR-ROUTE-03) -----------------------------------
  // "Weather/trivia-class questions never use more than one light call."
  // Order matters: easy-class wins over riskTier.
  let loop: LoopClass;
  if (isWeather || isTrivia || intent === 'chat' || intent === 'compute') {
    loop = 'light';
  } else if (intent === 'research') {
    loop = 'deep';
  } else if (riskTier >= 2) {
    loop = 'deep';
  } else {
    loop = 'standard';
  }

  const needsFreshInfo = FRESH_INFO_RE.test(trimmed) || intent === 'research';

  // --- Language ---------------------------------------------------------
  let language: Language = 'en';
  if (DEVANAGARI_RE.test(trimmed)) language = 'hi';
  else if (HINGLISH_RE.test(trimmed)) language = 'hinglish';

  // --- Confidence -------------------------------------------------------
  let confidence = 0.75;
  if (isWeather || isTrivia) confidence = 0.95;
  else if (intent !== 'chat' && intent !== 'question') confidence = 0.9;
  else if (intent === 'question') confidence = 0.8;

  return {
    intent: overrides.intent ?? intent,
    riskTier: overrides.riskTier ?? riskTier,
    needsFreshInfo: overrides.needsFreshInfo ?? needsFreshInfo,
    tools: overrides.tools ?? tools,
    loop: overrides.loop ?? loop,
    sensitivityHint: overrides.sensitivityHint ?? sensitivityHint,
    language: overrides.language ?? language,
    confidence: overrides.confidence ?? confidence,
  };
}