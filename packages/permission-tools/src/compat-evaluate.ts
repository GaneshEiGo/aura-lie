// packages/permission-tools/src/compat-evaluate.ts
// Internal helper for compat.ts. Mirrors autonomy-runner's `checkPermission`
// exactly: same inputs, same outputs.

import type { Resource, PermissionClass } from './types.js';
import { lookupMatrix } from './matrix.js';
import { HARMLESS_WRITE_RESOURCES, ALL_RESOURCES } from './types.js';
import type { CompatTask, CompatDecision } from './compat.js';

export function evaluateForCompat(
  task: CompatTask,
  level: 0 | 1 | 2 | 3,
): CompatDecision {
  const resource = task.resource as Resource;
  const cls = task.permissionClass as PermissionClass;

  // Hard absolute blocks (PRD 10.3)
  if (resource === 'payments') return 'never';
  if (resource === 'email') return 'never';
  if (resource === 'messages' && cls === 'send') return 'never';

  // Irreversible actions always ask (PRD 10.9)
  if (task.irreversible) return 'ask';

  // Harmless write override (PRD 10.9)
  if (cls === 'write' && HARMLESS_WRITE_RESOURCES.includes(resource)) {
    return level >= 2 ? 'allow' : 'ask';
  }

  if (!ALL_RESOURCES.includes(resource)) return 'ask';

  const cell = lookupMatrix(resource, cls);
  switch (cell.decision) {
    case 'allow':
      return 'allow';
    case 'ask':
      return 'ask';
    case 'never':
    case 'not_built':
      return 'never';
  }
}