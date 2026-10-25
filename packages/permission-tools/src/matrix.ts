// packages/permission-tools/src/matrix.ts
// PRD 10.3 permission matrix, verbatim from the PRD table.
//   Resource | READ | WRITE | SEND | DELETE
// Undefined cell = `never` (fail-closed).

import type { PermissionMatrix, Resource, PermissionClass, MatrixCell } from './types.js';

export const PERMISSION_MATRIX: PermissionMatrix = {
  memory: {
    read: { decision: 'allow' },
    write: { decision: 'allow', s2RequiresAsk: true },
    delete: { decision: 'ask' },
  },
  'project-files': {
    read: { decision: 'allow' },
    write: { decision: 'allow' },
    delete: { decision: 'ask' },
  },
  web: {
    read: { decision: 'allow' },
  },
  calendar: {
    read: { decision: 'allow' },
    write: { decision: 'allow' },
    delete: { decision: 'ask' },
  },
  tasks: {
    read: { decision: 'allow' },
    write: { decision: 'allow' },
    delete: { decision: 'ask' },
  },
  notifications: {
    send: { decision: 'allow', onlyWithinCaps: true },
  },
  messages: {
    send: { decision: 'never' },
  },
  // PRD 10.3: "Run code | n/a | ask once per session | n/a | n/a"
  // Represent as both `write` and `execute` — the autonomy-runner used `write`.
  code: {
    write: { decision: 'ask', askOncePerSession: true },
    execute: { decision: 'ask', askOncePerSession: true },
  },
  email: {
    read: { decision: 'not_built' },
    write: { decision: 'not_built' },
    send: { decision: 'not_built' },
    delete: { decision: 'not_built' },
  },
  payments: {
    read: { decision: 'never' },
    write: { decision: 'never' },
    send: { decision: 'never' },
    delete: { decision: 'never' },
  },
  settings: {
    read: { decision: 'allow' },
    write: { decision: 'ask' },
  },
};

/** Fail-closed cell lookup. Missing resource/class = 'never'. */
export function lookupMatrix(
  resource: Resource,
  cls: PermissionClass,
): MatrixCell {
  const row = PERMISSION_MATRIX[resource];
  const cell = row?.[cls];
  return cell ?? { decision: 'never' };
}