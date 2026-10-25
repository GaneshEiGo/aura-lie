// packages/permission-tools/src/compat.ts
// Compatibility shim for @aura-lie/autonomy-runner (Section 52).
// Provides a `checkPermission(task, level)` that returns the same
// 'allow' | 'ask' | 'never' decisions the runner expects.

import type { EnforceContext } from './types.js';
import { evaluateForCompat } from './compat-evaluate.js';

export interface CompatTask {
  resource: string;
  permissionClass: 'read' | 'write' | 'send' | 'delete' | 'execute';
  irreversible: boolean;
}

export type CompatDecision = 'allow' | 'ask' | 'never';

export function checkPermissionCompat(
  task: CompatTask,
  level: 0 | 1 | 2 | 3,
): CompatDecision {
  return evaluateForCompat(task, level);
}