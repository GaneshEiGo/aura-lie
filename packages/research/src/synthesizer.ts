import type { ResearchPlan, EvidenceItem, ResearchResult } from './types.js';

export class ResearchSynthesizer {
  public synthesize(plan: ResearchPlan, evidence: EvidenceItem[]): ResearchResult {
    const contradictions: string[] = [];
    const unknowns: string[] = [];

    // 1. Identify contradictions
    const claimGroups = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      if (!claimGroups.has(item.claim)) {
        claimGroups.set(item.claim, []);
      }
      claimGroups.get(item.claim)!.push(item);
    }

    for (const [claim, items] of claimGroups.entries()) {
      if (items.length > 1) {
        const quotes = new Set(items.map(i => i.quote));
        if (quotes.size > 1) {
          contradictions.push(`Conflicting sources on: "${claim}"`);
        }
      }
    }

    // 2. Identify unknowns
    if (evidence.length === 0) {
      unknowns.push('No evidence found to support the primary question.');
    }
    for (const q of plan.queries) {
      if (q.status === 'FAILED') {
        unknowns.push(`Failed to retrieve results for: "${q.text}"`);
      }
    }

    // 3. Generate synthesis
    let synthesis = `Research completed across ${plan.queries.length} queries. `;
    if (evidence.length > 0) {
      synthesis += `Found ${evidence.length} supporting pieces of evidence. `;
    } else {
      synthesis += `No direct evidence found. `;
    }
    if (contradictions.length > 0) {
      synthesis += `${contradictions.length} contradictions identified and listed below. `;
    }

    return {
      plan,
      evidence,
      contradictions,
      unknowns,
      synthesis
    };
  }
}