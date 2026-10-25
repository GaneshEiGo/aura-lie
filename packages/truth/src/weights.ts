// packages/truth/src/weights.ts
// Versioned, named constants from PRD 8.7.

export const WEIGHTS = {
  S: 0.35,
  E: 0.30,
  A: 0.20,
  F: 0.10,
  C: 0.05,
} as const;

export const C_RENORMALIZED_TOTAL = WEIGHTS.S + WEIGHTS.E + WEIGHTS.A + WEIGHTS.F; // 0.95

export const BAND_THRESHOLDS = {
  VERIFIED: 85,
  SUPPORTED: 70,
  MIXED: 50,
} as const;

export const HARD_CAPS = {
  NO_SOURCE: 59,
  QUOTE_FAIL: 40,
  INTERESTED_PARTY: 69,
  STRONG_CONTRADICTION: 69,
} as const;

export const PENALTIES = {
  STRONG_CONTRADICTION: 15,
  WEAK_CONTRADICTION: 6,
} as const;

export const WEAKEST_CRITICAL_MARGIN = 15;

export const MAX_QUOTE_WORDS = 25;

export const FRESHNESS_HALF_LIVES_DAYS = {
  breaking_news: 2,
  prices_markets: 1,
  software_versions: 60,
  policies_pricing: 90,
  organisation_roles: 180,
  scientific_findings: 365 * 3,
} as const;

export const WEIGHTS_VERSION = '1.0.0';