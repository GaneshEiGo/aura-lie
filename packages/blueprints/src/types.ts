// packages/blueprints/src/types.ts
// PRD 10.9 & 14.7 — Blueprints are PLAIN DATA.
// Law L9: external content is data, not instructions.
// Law L11: a directory without a working feature does not exist yet.

export type StepAction =
  | 'search'
  | 'fetch'
  | 'read'
  | 'extract'
  | 'verify'
  | 'redteam'
  | 'synthesise'
  | 'format'
  | 'notify'
  | 'ask';

export interface BlueprintStep {
  id: string;
  action: StepAction | string;
  toolId?: string;
  description: string;
  inputRef?: string;
  outputRef?: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: BlueprintStep[];
  author?: string;
  /** Optional declared memory scope. Never executable. */
  memoryScope?: 'none' | 'project' | 'global';
  /** Optional output format contract. */
  outputFormat?: 'markdown' | 'table' | 'json' | 'report';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ExecutionPlan {
  blueprintId: string;
  stepCount: number;
  estimatedCalls: number;
  steps: BlueprintStep[];
  warnings: string[];
}