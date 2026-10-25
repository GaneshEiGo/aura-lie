import type { ExtractedClaim } from './types.js';

/**
 * PRD Section 8.3: Claim Extraction
 * Uses the prompt defined in Appendix B.3
 */
export class ClaimExtractor {
  public buildPrompt(answer: string, cap: number = 8): string {
    return `From the ANSWER, list atomic, checkable factual claims.
Rules:
- One fact per claim.
- Make each claim understandable alone (replace pronouns with names).
- Skip opinions, jokes, fiction and anything the USER supplied.
- Maximum ${cap} claims, central ones first.

Return JSON only: [{"text": "..", "type": "numeric|date|entity-relation|definition|causal|comparison|forecast", "importance": "central|supporting", "volatility": "stable|slow|fast"}]

ANSWER: ${answer}`;
  }

  public parseResponse(jsonString: string): ExtractedClaim[] {
    try {
      // Strip markdown formatting if the LLM included it
      const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsed)) return [];
      
      // Return with basic fallback validation
      return parsed.map((c: any) => ({
        text: String(c.text || ''),
        type: c.type || 'definition',
        importance: c.importance || 'supporting',
        volatility: c.volatility || 'stable'
      }));
    } catch {
      return [];
    }
  }
}