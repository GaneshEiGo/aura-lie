import { classifySensitivity } from '@aura-lie/security';
import type { Sensitivity } from '@aura-lie/shared';

export interface PlannerResult {
  intent: 'chat' | 'research' | 'fact';
  riskTier: number;
  sensitivity: Sensitivity;
  needsFreshInfo: boolean;
}

export function planRequest(query: string): PlannerResult {
  const lower = query.toLowerCase();
  const sensitivity = classifySensitivity(query);
  
  let intent: PlannerResult['intent'] = 'chat';
  let riskTier = 0;
  let needsFreshInfo = false;

  if (lower.includes('research') || lower.includes('find out') || lower.includes('sources')) {
    intent = 'research';
    riskTier = 2;
    needsFreshInfo = true;
  } else if (lower.includes('fact check') || lower.includes('is it true')) {
    intent = 'fact';
    riskTier = 1;
    needsFreshInfo = true;
  }

  if (sensitivity === 'S2' && /health|legal|finance|money|doctor/.test(lower)) {
    riskTier = 3;
  }

  return { intent, riskTier, sensitivity, needsFreshInfo };
}