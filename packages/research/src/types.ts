export interface ResearchQuery {
  id: string;
  text: string;
  status: 'PENDING' | 'SEARCHING' | 'FETCHED' | 'FAILED';
  resultsCount: number;
}

export interface ResearchPlan {
  question: string;
  queries: ResearchQuery[];
  maxSteps: number;
}

export interface EvidenceItem {
  claim: string;
  sourceUrl: string;
  quote: string;
  confidence: number;
}

export interface ResearchResult {
  plan: ResearchPlan;
  evidence: EvidenceItem[];
  contradictions: string[];
  unknowns: string[];
  synthesis: string;
}