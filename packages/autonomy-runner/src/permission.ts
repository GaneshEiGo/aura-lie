// packages/autonomy-runner/src/permission.ts
// PRD 10.3 + 10.9: "Risky operations (send, delete, spend, publish) always
// ask." "Harmless operations ... run without asking at Level 2 and above."

import type {
  AutonomyLevel,
  PermissionDecision,
  Task,
} from './types.js';
import {
  DEFAULT_PERMISSION_MATRIX,
  HARMLESS_WRITE_RESOURCES,
} from './types.js';

export function checkPermission(
  task: Task,
  level: AutonomyLevel,
): PermissionDecision {
  // Absolute blocks (PRD 10.3)
  if (task.resource === 'payments') return 'never';
  if (task.resource === 'email') return 'never';
  if (task.resource === 'messages' && task.permissionClass === 'send') {
    return 'never';
  }

  // Irreversible actions always ask (PRD 10.9)
  if (task.irreversible) return 'ask';

  // Harmless write at Level 2+: allow without asking
  if (
    level >= 2 &&
    task.permissionClass === 'write' &&
    HARMLESS_WRITE_RESOURCES.includes(task.resource)
  ) {
    return 'allow';
  }

  // Harmless write at Level 0-1: ask (override the matrix's default allow)
  if (
    level < 2 &&
    task.permissionClass === 'write' &&
    HARMLESS_WRITE_RESOURCES.includes(task.resource)
  ) {
    return 'ask';
  }

  // Otherwise follow the matrix
  const row = DEFAULT_PERMISSION_MATRIX[task.resource];
  if (!row) return 'ask';
  return row[task.permissionClass] ?? 'ask';
}