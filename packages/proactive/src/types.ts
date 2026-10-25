export interface TriggerContext {
  relevance: number;  // R: 0.0 to 1.0
  urgency: number;    // U: 0.0 to 1.0
  novelty: number;    // N: 0.0 to 1.0
  fatigue: number;    // Fa: max(notes_today/cap, ignored_rate_7d)
  consent: boolean;   // K: 0 or 1
}

export interface ProactiveDecision {
  allowed: boolean;
  reason: string;
  score: number;
}