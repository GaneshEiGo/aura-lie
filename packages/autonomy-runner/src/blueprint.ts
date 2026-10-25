// packages/autonomy-runner/src/blueprint.ts
// F-103: "Save a mission as a reusable recipe ... Shared as a plain file,
// never executable code." Law L9 enforced.
// F-098 / W8: reuse the same schema as Section 45.

import type { Goal, Task } from './types.js';

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  version: string;
  schemaVersion: 1;
  goalDescription: string;
  schedule?: string;
  memoryScope?: 'none' | 'project' | 'global';
  outputFormat?: 'markdown' | 'table' | 'json' | 'report';
  tasks: Array<{
    id: string;
    description: string;
    action: string;
    resource: string;
    permissionClass: 'read' | 'write' | 'send' | 'delete' | 'execute';
    dependsOn: string[];
    irreversible: boolean;
  }>;
}

export interface BlueprintValidation {
  valid: boolean;
  errors: string[];
}

const FORBIDDEN_PATTERNS = [
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /<script\b/i,
  /javascript\s*:/i,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\./i,
];

export function validateAgentBlueprint(bp: unknown): BlueprintValidation {
  const errors: string[] = [];
  if (!bp || typeof bp !== 'object') {
    return { valid: false, errors: ['Blueprint is not an object'] };
  }
  const b = bp as Partial<AgentBlueprint>;
  if (!b.id || typeof b.id !== 'string') errors.push('missing id');
  if (!b.name || typeof b.name !== 'string') errors.push('missing name');
  if (!b.version || typeof b.version !== 'string') errors.push('missing version');
  if (b.schemaVersion !== 1) errors.push('unsupported schemaVersion');
  if (!b.goalDescription || typeof b.goalDescription !== 'string') {
    errors.push('missing goalDescription');
  }
  if (!Array.isArray(b.tasks)) errors.push('missing tasks array');

  try {
    const serialised = JSON.stringify(bp);
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(serialised)) {
        errors.push(`security violation: forbidden pattern ${re.source}`);
      }
    }
  } catch {
    errors.push('blueprint not JSON-serialisable');
  }

  return { valid: errors.length === 0, errors };
}

export function blueprintToGoal(bp: AgentBlueprint, now: number = Date.now()): Goal {
  const tasks: Task[] = bp.tasks.map((t) => ({
    id: t.id,
    description: t.description,
    action: t.action,
    resource: t.resource,
    permissionClass: t.permissionClass,
    dependsOn: t.dependsOn,
    irreversible: t.irreversible,
    status: 'pending',
    approval: 'not_required',
  }));
  return {
    id: `goal-${bp.id}-${now}`,
    description: bp.goalDescription,
    tasks,
    createdAt: now,
  };
}