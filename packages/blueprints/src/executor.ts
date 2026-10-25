// packages/blueprints/src/executor.ts
// PRD 10.9 — "Runner: steps run as resumable jobs."
// Pure planning / dry-run helper. NEVER executes tools here.
// Real execution lives in `packages/agents` at W7.

import type { Blueprint, ExecutionPlan } from './types.js';
import { BlueprintValidator } from './validator.js';

export class BlueprintExecutor {
  private readonly validator = new BlueprintValidator();

  /**
   * Returns a dry-run plan. Rejects invalid blueprints before any job
   * is queued (Law L7 — no silent actions).
   */
  public prepare(blueprint: Blueprint): ExecutionPlan {
    const check = this.validator.validate(blueprint);
    if (!check.valid) {
      throw new Error(
        `Cannot prepare invalid blueprint: ${check.errors.join('; ')}`,
      );
    }
    return this.validator.plan(blueprint);
  }

  /**
   * Returns the ordered action list a mission runner will consume.
   * Structured hand-off only — never raw transcripts (PRD 10.9).
   */
  public toHandoff(blueprint: Blueprint): Array<{ id: string; action: string; description: string }> {
    return blueprint.steps.map((s) => ({
      id: s.id,
      action: s.action,
      description: s.description,
    }));
  }
}