import { describe, it, expect } from 'vitest';
import { ResearchPlanner } from '../src/planner.js';
import { ResearchSynthesizer } from '../src/synthesizer.js';

describe('Deep Research Orchestrator (PRD W5)', () => {
  const planner = new ResearchPlanner();
  const synthesizer = new ResearchSynthesizer();

  it('should decompose a question into a plan', () => {
    const plan = planner.createPlan('What is the efficiency of solid state batteries?', 3);
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(plan.queries[0].text).toBe('What is the efficiency of solid state batteries?');
  });

  it('should detect contradictions in evidence', () => {
    const plan = planner.createPlan('Test question', 1);
    const evidence = [
      { claim: 'Efficiency is 41%', sourceUrl: 'https://a.com', quote: '41%', confidence: 100 },
      { claim: 'Efficiency is 41%', sourceUrl: 'https://b.com', quote: '45%', confidence: 100 }
    ];

    const result = synthesizer.synthesize(plan, evidence);
    expect(result.contradictions.length).toBe(1);
    expect(result.contradictions[0]).toContain('Conflicting sources');
  });

  it('should identify unknowns when evidence is missing', () => {
    const plan = planner.createPlan('Test question', 1);
    plan.queries[0].status = 'FAILED';
    
    const result = synthesizer.synthesize(plan, []);
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(result.synthesis).toContain('No direct evidence found');
  });
});