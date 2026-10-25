// === FILE START ===
// packages/agents/src/opportunity-v2.ts
// PRD §10.9 · F-094 · T-13.
//
// Opportunity engine. Given a project's current capabilities (each with an
// evidence count) and a list of candidate extensions, produce an evidence-
// based proposal for each candidate.
//
// Hard rule from PRD §10.9: "It proposes. It never starts it."
// This module is therefore a pure function. It has no side effects, no
// execution, no writes, no network. Every returned proposal is plain data.
//
// Confidence is the fraction of required capabilities that the project
// already has evidence for, scaled 0-100. Recommendations:
//   · pursue — confidence >= 80 and nothing missing
//   · wait   — confidence >= 50
//   · skip   — otherwise
//
// Zero external imports.

export interface ProjectCapability {
  id: string;
  name: string;
  /** How many artifacts (files, claims, memories) support this capability. */
  evidenceCount: number;
}

export interface ProposedExtension {
  id: string;
  name: string;
  description: string;
  requiredCapabilities: string[];
}

export type Recommendation = 'pursue' | 'wait' | 'skip';

export interface OpportunityProposal {
  extension: ProposedExtension;
  evidence: string[];
  missing: string[];
  /** 0-100. */
  confidence: number;
  recommendation: Recommendation;
  rationale: string;
}

const PURSUE_THRESHOLD = 80;
const WAIT_THRESHOLD = 50;

const RECOMMENDATION_ORDER: Record<Recommendation, number> = {
  pursue: 0,
  wait: 1,
  skip: 2,
};

export function findOpportunities(
  capabilities: readonly ProjectCapability[],
  candidates: readonly ProposedExtension[],
): OpportunityProposal[] {
  const capById = new Map<string, ProjectCapability>();
  for (const c of capabilities) capById.set(c.id, c);

  const proposals: OpportunityProposal[] = [];

  for (const ext of candidates) {
    const evidence: string[] = [];
    const missing: string[] = [];

    for (const reqId of ext.requiredCapabilities) {
      const cap = capById.get(reqId);
      if (cap !== undefined && cap.evidenceCount > 0) {
        evidence.push(reqId);
      } else {
        missing.push(reqId);
      }
    }

    const total = ext.requiredCapabilities.length;
    const covered = evidence.length;
    const confidence = total === 0 ? 100 : Math.round((covered / total) * 100);

    let recommendation: Recommendation;
    if (confidence >= PURSUE_THRESHOLD && missing.length === 0) {
      recommendation = 'pursue';
    } else if (confidence >= WAIT_THRESHOLD) {
      recommendation = 'wait';
    } else {
      recommendation = 'skip';
    }

    let rationale: string;
    if (total === 0) {
      rationale =
        'Extension declares no required capabilities; nothing to check.';
    } else if (missing.length === 0) {
      rationale =
        `All ${total} required capabilities are present with evidence. ` +
        `Ready to pursue when you choose.`;
    } else if (covered === 0) {
      rationale =
        `None of the ${total} required capabilities are present. ` +
        `Missing: ${missing.join(', ')}.`;
    } else {
      rationale =
        `${covered} of ${total} required capabilities present. ` +
        `Missing: ${missing.join(', ')}.`;
    }

    proposals.push({
      extension: {
        id: ext.id,
        name: ext.name,
        description: ext.description,
        requiredCapabilities: [...ext.requiredCapabilities],
      },
      evidence,
      missing,
      confidence,
      recommendation,
      rationale,
    });
  }

  proposals.sort((a, b) => {
    const oa = RECOMMENDATION_ORDER[a.recommendation];
    const ob = RECOMMENDATION_ORDER[b.recommendation];
    if (oa !== ob) return oa - ob;
    return b.confidence - a.confidence;
  });

  return proposals;
}
// === FILE END ===