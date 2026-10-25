import type { Sensitivity, Mode } from './events.js';

export interface Plan {
  intent: string;
  riskTier: 0 | 1 | 2 | 3;
  needsFreshInfo: boolean;
  loop: 'light' | 'standard' | 'deep';
  sensitivity: Sensitivity;
}

export class Planner {
  public plan(message: string, requestedMode: Mode): Plan {
    const lower = message.toLowerCase();
    
    let sensitivity: Sensitivity = 'S0';
    if (/(password|secret|health|doctor|money|bank|salary)/i.test(lower)) {
      sensitivity = 'S2';
    } else if (/(my project|my code|i prefer|remember)/i.test(lower)) {
      sensitivity = 'S1';
    }

    let riskTier: 0 | 1 | 2 | 3 = 0;
    if (/(medical|legal|invest|diagnose|cure)/i.test(lower)) {
      riskTier = 3;
    } else if (/(news|current|price|weather|today|latest)/i.test(lower)) { // Added 'latest' here to fix the test
      riskTier = 2;
    } else if (lower.length > 20) {
      riskTier = 1; 
    }

    const needsFreshInfo = /(latest|today|current|news|price|who is)/i.test(lower);

    let loop: 'light' | 'standard' | 'deep' = 'light';
    if (requestedMode === 'research') loop = 'deep';
    else if (requestedMode === 'think' || riskTier >= 2) loop = 'standard';

    return {
      intent: riskTier > 0 ? 'question' : 'chat',
      riskTier,
      needsFreshInfo,
      loop,
      sensitivity,
    };
  }
}