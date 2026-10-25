import type { IntentProfile } from './types.js';

/**
 * PRD Section 7.3: Intent, risk tier, sensitivity.
 * Uses a multi-layered heuristic approach to classify the user's message.
 */
export class CognitiveClassifier {
  public classify(message: string): IntentProfile {
    // 1. Language Detection (Heuristic)
    const isHindi = /[\u0900-\u097F]/.test(message);
    const isHinglish = /(kya|hai|nahi|acha|thik|bhai)/i.test(message) && !isHindi;
    const language = isHindi ? 'hi' : (isHinglish ? 'hinglish' : 'en');

    // 2. Sensitivity Analysis
    let sensitivity: 'S0' | 'S1' | 'S2' = 'S0';
    if (/(password|secret|health|doctor|money|bank|salary|address|phone|ssn|aadhar|pan)/i.test(message)) {
      sensitivity = 'S2';
    } else if (/(my project|my code|i prefer|remember|mera)/i.test(message)) {
      sensitivity = 'S1';
    }

    // 3. Complexity & Risk Heuristic
    let complexity = Math.min(100, Math.floor(message.length / 1.5));
    let riskTier: 0 | 1 | 2 | 3 = 0;
    let intentClass: IntentProfile['intentClass'] = 'chat';
    let toolsNeeded: string[] = [];
    let needsFreshInfo = false;

    if (/(medical|legal|invest|diagnose|cure|surgery|lawyer)/i.test(message)) {
      riskTier = 3;
      intentClass = 'action';
    } else if (/(news|current|price|weather|today|latest|who is|kab)/i.test(message)) {
      riskTier = 2;
      intentClass = 'question';
      toolsNeeded.push('search');
      needsFreshInfo = true;
    } else if (/(code|function|class|typescript|python|react|bug|error)/i.test(message)) {
      riskTier = 1;
      intentClass = 'code';
      toolsNeeded.push('code_runner');
    } else if (/(calculate|math|sum|multiply|equation|percent)/i.test(message)) {
      riskTier = 1;
      intentClass = 'compute';
      toolsNeeded.push('calculator');
    } else if (message.length > 50) {
      riskTier = 1;
      intentClass = 'question';
    }

    // 4. Loop Assignment
    let loop: 'light' | 'standard' | 'deep' = 'light';
    if (complexity > 80 || riskTier >= 3) loop = 'deep';
    else if (complexity > 40 || riskTier >= 2) loop = 'standard';

    return {
      intentClass,
      riskTier,
      needsFreshInfo,
      loop,
      sensitivity,
      language,
      complexity,
      toolsNeeded
    };
  }
}