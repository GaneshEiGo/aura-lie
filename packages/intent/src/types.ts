export interface IntentProfile {
  intentClass: 'chat' | 'question' | 'research' | 'compute' | 'create' | 'plan' | 'code' | 'file' | 'memory' | 'action' | 'meta';
  riskTier: 0 | 1 | 2 | 3;
  needsFreshInfo: boolean;
  loop: 'light' | 'standard' | 'deep';
  sensitivity: 'S0' | 'S1' | 'S2';
  language: string;
  complexity: number;
  toolsNeeded: string[];
}