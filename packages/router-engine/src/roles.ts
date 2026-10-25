// packages/router-engine/src/roles.ts
// PRD 7.4 role mapping. `requiredCapabilities` derives from role + features.

import type { Candidate, Features, ModelRole } from './types.js';

export function requiredCapabilities(
  role: ModelRole,
  features: Features,
): Array<'reasoning' | 'vision' | 'json' | 'tools'> {
  const caps: Array<'reasoning' | 'vision' | 'json' | 'tools'> = [];
  if (role === 'reasoner') caps.push('reasoning');
  if (role === 'vision') caps.push('vision');
  if (role === 'judge') caps.push('json');
  if (features.tools.length > 0) caps.push('tools');
  return caps;
}

export function toCandidate(
  family: Candidate['family'],
  model: string,
  role: ModelRole,
): Candidate {
  return { family, model, role };
}

/** PRD 7.4 latency_fit: fast roles prefer fast models; reasoner prefers strong. */
export function latencyFitFor(
  role: ModelRole,
  latencyClass: 'fast' | 'balanced' | 'strong',
): number {
  if (role === 'chat_fast' || role === 'utility' || role === 'embed') {
    return latencyClass === 'fast' ? 1.0 : latencyClass === 'balanced' ? 0.7 : 0.4;
  }
  if (role === 'reasoner' || role === 'chat_quality' || role === 'judge') {
    return latencyClass === 'strong' ? 1.0 : latencyClass === 'balanced' ? 0.75 : 0.5;
  }
  return 0.7; // neutral for vision / long_context
}