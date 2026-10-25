// packages/autonomy-runner/src/dryrun.ts
// F-099: "Before executing, Aura-lie lists planned reads, writes, searches
// and outputs, with 'no external actions will occur', then asks Execute."

import type { DryRunPlan, Goal } from './types.js';

export function planDryRun(goal: Goal): DryRunPlan {
  const reads: string[] = [];
  const writes: string[] = [];
  const searches: string[] = [];
  const outputs: string[] = [];

  for (const task of goal.tasks) {
    const label = `[${task.id}] ${task.description}`;
    if (task.permissionClass === 'read' && task.resource === 'web') {
      searches.push(label);
    } else if (task.permissionClass === 'read') {
      reads.push(label);
    } else if (task.permissionClass === 'write') {
      writes.push(label);
    } else if (
      task.permissionClass === 'send' ||
      task.permissionClass === 'delete' ||
      task.permissionClass === 'execute'
    ) {
      writes.push(label);
    }
    if (task.status === 'done') {
      outputs.push(label);
    }
  }

  return {
    reads,
    writes,
    searches,
    outputs,
    noExternalActions: true,
    estimatedCalls: goal.tasks.length,
    requiresApproval: goal.tasks.some(
      (t) => t.irreversible && t.approval !== 'approved',
    ),
  };
}

export function renderDryRun(plan: DryRunPlan): string {
  const lines: string[] = [];
  if (plan.reads.length) {
    lines.push(`Will read ${plan.reads.length}: ${plan.reads.join('; ')}`);
  }
  if (plan.writes.length) {
    lines.push(`Will write ${plan.writes.length}: ${plan.writes.join('; ')}`);
  }
  if (plan.searches.length) {
    lines.push(
      `Will search ${plan.searches.length}: ${plan.searches.join('; ')}`,
    );
  }
  if (plan.outputs.length) {
    lines.push(
      `Will output ${plan.outputs.length}: ${plan.outputs.join('; ')}`,
    );
  }
  lines.push('No external actions will occur.');
  if (plan.requiresApproval) {
    lines.push('Approval required before any irreversible step runs.');
  }
  return lines.join('\n');
}