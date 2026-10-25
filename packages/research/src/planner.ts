import type { ResearchPlan, ResearchQuery } from './types.js';

export class ResearchPlanner {
  public createPlan(question: string, maxSteps: number = 4): ResearchPlan {
    // Decompose question into sub-queries (simplified heuristic)
    const words = question.split(' ').filter(w => w.length > 3);
    const queries: ResearchQuery[] = [];

    // Base query
    queries.push({
      id: crypto.randomUUID(),
      text: question,
      status: 'PENDING',
      resultsCount: 0
    });

    // Sub-queries based on entities (simplified)
    if (words.length > 0) {
      queries.push({
        id: crypto.randomUUID(),
        text: `${words[0]} evidence data`,
        status: 'PENDING',
        resultsCount: 0
      });
    }

    return {
      question,
      queries: queries.slice(0, maxSteps),
      maxSteps
    };
  }
}