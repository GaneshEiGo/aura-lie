// packages/blueprints/test/blueprints.test.ts
import { describe, it, expect } from 'vitest';
import { BlueprintValidator, BlueprintExecutor } from '../src/index.js';
import type { Blueprint } from '../src/types.js';

describe('Blueprint Engine (PRD 10.9, 14.7)', () => {
  const validator = new BlueprintValidator();
  const executor = new BlueprintExecutor();

  const validBlueprint: Blueprint = {
    id: 'bp-1',
    name: 'Research Task',
    description: 'A basic research workflow',
    version: '1.0.0',
    outputFormat: 'markdown',
    steps: [
      { id: 's1', action: 'search', toolId: 'search', description: 'Search the web' },
      { id: 's2', action: 'fetch',  toolId: 'fetch',  description: 'Fetch pages' },
    ],
  };

  it('validates a correct blueprint', () => {
    const result = validator.validate(validBlueprint);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects a blueprint missing required fields', () => {
    const invalid = { ...validBlueprint, name: undefined };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid name');
  });

  it('rejects a blueprint with executable code patterns (Law L9)', () => {
    const malicious = {
      ...validBlueprint,
      steps: [
        { id: 's1', action: 'run', description: 'eval("process.exit()")' },
      ],
    };
    const result = validator.validate(malicious);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Security violation');
  });

  it('produces a deterministic dry-run plan', () => {
    const plan = executor.prepare(validBlueprint);
    expect(plan.blueprintId).toBe('bp-1');
    expect(plan.stepCount).toBe(2);
    expect(plan.estimatedCalls).toBe(3);
    expect(plan.warnings.length).toBe(0);
  });

  it('refuses to prepare an invalid blueprint', () => {
    const broken = { ...validBlueprint, steps: 'not-an-array' };
    expect(() => executor.prepare(broken as any)).toThrow(/invalid blueprint/i);
  });

  it('produces a structured hand-off (no transcripts)', () => {
    const handoff = executor.toHandoff(validBlueprint);
    expect(handoff).toEqual([
      { id: 's1', action: 'search', description: 'Search the web' },
      { id: 's2', action: 'fetch',  description: 'Fetch pages' },
    ]);
  });
});