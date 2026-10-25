// packages/autonomy-runner/test/autonomy-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildGoal,
  readyTasks,
  isGoalComplete,
  markTask,
  topologicalOrder,
  detectCycle,
  GoalStackError,
  checkStopConditions,
  describeStop,
  ENERGY_BUDGET,
  startOfLocalDay,
  rolloverEnergy,
  canAfford,
  consume,
  remaining,
  checkPermission,
  validateHandoff,
  planDryRun,
  renderDryRun,
  createMission,
  Runner,
  MISSION_MAX_STEPS,
  MISSION_STEP_EXTERNAL_CAP,
  parseOneSentenceAgent,
  validateAgentBlueprint,
  blueprintToGoal,
} from '../src/index.js';
import type {
  EnergyState,
  MissionState,
  Task,
} from '../src/types.js';

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------
function fixedClock(at: number): {
  clock: { now(): number };
  add: (d: number) => void;
} {
  let current = at;
  return {
    clock: { now: () => current },
    add: (d: number) => {
      current += d;
    },
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    description: 'test task',
    action: 'read',
    resource: 'web',
    permissionClass: 'read',
    dependsOn: [],
    irreversible: false,
    status: 'pending',
    approval: 'not_required',
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
describe('Autonomy Runner (PRD 10.9, FR-AGENT-01..08)', () => {
  // ---- Goal stack ----------------------------------------------------
  it('buildGoal creates tasks with the default status', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
      { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
    ]);
    expect(goal.tasks.length).toBe(2);
    expect(goal.tasks[0].status).toBe('pending');
    expect(goal.tasks[1].dependsOn).toEqual(['a']);
  });

  it('buildGoal rejects a task that depends on an unknown id', () => {
    expect(() =>
      buildGoal('test', [
        { id: 'a', description: 'A', action: 'read', resource: 'web', dependsOn: ['missing'] },
      ]),
    ).toThrow(GoalStackError);
  });

  it('buildGoal rejects cyclic dependencies', () => {
    expect(() =>
      buildGoal('test', [
        { id: 'a', description: 'A', action: 'read', resource: 'web', dependsOn: ['b'] },
        { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
      ]),
    ).toThrow(/cycle/i);
  });

  it('readyTasks only returns tasks whose dependencies are done', () => {
    let goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
      { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
    ]);
    expect(readyTasks(goal).map((t) => t.id)).toEqual(['a']);
    goal = markTask(goal, 'a', 'done');
    expect(readyTasks(goal).map((t) => t.id)).toEqual(['b']);
  });

  it('isGoalComplete returns true when all tasks are done', () => {
    let goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    expect(isGoalComplete(goal)).toBe(false);
    goal = markTask(goal, 'a', 'done');
    expect(isGoalComplete(goal)).toBe(true);
  });

  it('topologicalOrder respects dependencies', () => {
    const goal = buildGoal('test', [
      { id: 'c', description: 'C', action: 'read', resource: 'web', dependsOn: ['b'] },
      { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    expect(topologicalOrder(goal.tasks)).toEqual(['a', 'b', 'c']);
  });

  it('detectCycle accepts a linear DAG', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    expect(() => detectCycle(tasks)).not.toThrow();
  });

  // ---- Stop conditions ------------------------------------------------
  it('stop: kill-switch fires first', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    const stop = checkStopConditions({
      goal,
      mission,
      options: { killSwitch: true },
      now: 2000,
    });
    expect(stop).toBe('kill-switch');
  });

  it('stop: iteration-limit when step >= maxSteps', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    mission.step = mission.maxSteps;
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('iteration-limit');
  });

  it('stop: time-limit when now > deadlineAt', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000, deadlineAt: 1500 });
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('time-limit');
  });

  it('stop: goal-achieved when all tasks are done', () => {
    let goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    goal = markTask(goal, 'a', 'done');
    const mission = createMission({ goal, startAt: 1000 });
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('goal-achieved');
  });

  it('stop: evidence-sufficient when enough sources collected', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    mission.handoff = {
      sources: [
        { id: 's1', url: 'https://a' },
        { id: 's2', url: 'https://b' },
      ],
    };
    const stop = checkStopConditions({
      goal,
      mission,
      options: { evidenceSourceRequirement: 2 },
      now: 2000,
    });
    expect(stop).toBe('evidence-sufficient');
  });

  it('stop: unresolved contradiction blocks mission', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    mission.handoff = {
      contradictions: [{ claimA: 'c1', claimB: 'c2', resolved: false }],
    };
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('unresolved-contradiction');
  });

  it('stop: permission-required for irreversible task without approval', () => {
    const goal = buildGoal('test', [
      {
        id: 'a',
        description: 'irreversible',
        action: 'delete',
        resource: 'tasks',
        permissionClass: 'write',
        irreversible: true,
      },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('permission-required');
  });

  it('stop: no-progress fires after 3 steps with no artifacts', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
      { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    mission.history = [0, 1, 2].map((i) => ({
      index: i,
      taskId: 'a',
      action: 'read',
      result: 'done' as const,
      externalCalls: 0,
      at: 1000 + i,
      outputArtifacts: 0,
    }));
    const stop = checkStopConditions({ goal, mission, options: {}, now: 2000 });
    expect(stop).toBe('no-progress');
  });

  it('describeStop returns a non-empty string for every reason', () => {
    const reasons = [
      'kill-switch',
      'iteration-limit',
      'time-limit',
      'goal-achieved',
      'evidence-sufficient',
      'unresolved-contradiction',
      'permission-required',
      'no-progress',
    ] as const;
    for (const r of reasons) {
      expect(describeStop(r).length).toBeGreaterThan(0);
    }
  });

  // ---- Energy budget --------------------------------------------------
  it('ENERGY_BUDGET matches PRD 10.2', () => {
    expect(ENERGY_BUDGET[0]).toBe(0);
    expect(ENERGY_BUDGET[1]).toBe(10);
    expect(ENERGY_BUDGET[2]).toBe(40);
    expect(ENERGY_BUDGET[3]).toBe(60);
  });

  it('canAfford / consume respect the budget', () => {
    const at = new Date(2026, 9, 20, 12).getTime();
    const start: EnergyState = { level: 2, used: 30, at: startOfLocalDay(at) };
    expect(canAfford(start, 10)).toBe(true);
    expect(canAfford(start, 11)).toBe(false);
    expect(consume(start, 5).used).toBe(35);
    expect(remaining(start)).toBe(10);
  });

  it('energy budget rolls over at local midnight', () => {
    const yesterday = new Date(2026, 9, 19, 22).getTime();
    const today = new Date(2026, 9, 20, 9).getTime();
    const state: EnergyState = {
      level: 2,
      used: 35,
      at: startOfLocalDay(yesterday),
    };
    const rolled = rolloverEnergy(state, today);
    expect(rolled.used).toBe(0);
    expect(rolled.at).toBe(startOfLocalDay(today));
  });

  // ---- Permission matrix ---------------------------------------------
  it('permission: memory write at Level 1 asks', () => {
    const t = makeTask({ resource: 'memory', permissionClass: 'write' });
    expect(checkPermission(t, 1)).toBe('ask');
  });

  it('permission: memory write at Level 2 allows (harmless override)', () => {
    const t = makeTask({ resource: 'memory', permissionClass: 'write' });
    expect(checkPermission(t, 2)).toBe('allow');
  });

  it('permission: settings write at Level 2 still asks (matrix)', () => {
    const t = makeTask({ resource: 'settings', permissionClass: 'write' });
    expect(checkPermission(t, 2)).toBe('ask');
  });

  it('permission: irreversible actions always ask', () => {
    const t = makeTask({
      resource: 'tasks',
      permissionClass: 'write',
      irreversible: true,
    });
    expect(checkPermission(t, 3)).toBe('ask');
  });

  it('permission: payments are never allowed', () => {
    const t = makeTask({ resource: 'payments', permissionClass: 'read' });
    expect(checkPermission(t, 3)).toBe('never');
  });

  it('permission: messages.send is never in v1', () => {
    const t = makeTask({ resource: 'messages', permissionClass: 'send' });
    expect(checkPermission(t, 3)).toBe('never');
  });

  // ---- Handoff -------------------------------------------------------
  it('handoff: accepts a structured payload', () => {
    const r = validateHandoff({
      claims: [{ id: 'c1', text: 'A claim', status: 'SUPPORTED' }],
      sources: [{ id: 's1', url: 'https://a' }],
    });
    expect(r.valid).toBe(true);
  });

  it('handoff: rejects a raw transcript', () => {
    const r = validateHandoff({
      transcript: 'a'.repeat(2000),
      claims: [],
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/transcript/i);
  });

  it('handoff: rejects an empty payload', () => {
    const r = validateHandoff({});
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at least one of/i);
  });

  // ---- Dry run --------------------------------------------------------
  it('dryrun: no external actions will occur', () => {
    const goal = buildGoal('research', [
      { id: 'a', description: 'Search the web', action: 'search', resource: 'web', permissionClass: 'read' },
      { id: 'b', description: 'Write a task', action: 'create', resource: 'tasks', permissionClass: 'write' },
    ]);
    const plan = planDryRun(goal);
    expect(plan.noExternalActions).toBe(true);
    expect(plan.searches.length).toBe(1);
    expect(plan.writes.length).toBe(1);
    expect(plan.requiresApproval).toBe(false);
  });

  it('dryrun: requiresApproval when a task is irreversible and unapproved', () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'delete', action: 'delete', resource: 'tasks', permissionClass: 'write', irreversible: true },
    ]);
    const plan = planDryRun(goal);
    expect(plan.requiresApproval).toBe(true);
    expect(renderDryRun(plan)).toMatch(/No external actions will occur/);
  });

  // ---- Runner --------------------------------------------------------
  it('runner: executes a single step and marks the task done', async () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    const executor = vi.fn(async () => ({
      result: 'done' as const,
      externalCalls: 1,
      outputArtifacts: 1,
    }));
    const runner = new Runner(executor, { level: 2 });

    const outcome = await runner.step(mission);
    expect(outcome.executedTaskId).toBe('a');
    expect(outcome.state.history.length).toBe(1);
    expect(outcome.state.goal.tasks[0].status).toBe('done');
    // After one step, goal-achieved should fire
    expect(outcome.stopped).toBe(true);
    expect(outcome.stopReason).toBe('goal-achieved');
  });

  it('runner: mission survives JSON round-trip', async () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
      { id: 'b', description: 'B', action: 'read', resource: 'web', dependsOn: ['a'] },
    ]);
    let mission = createMission({ goal, startAt: 1000 });
    const executor = vi.fn(async () => ({
      result: 'done' as const,
      externalCalls: 1,
      outputArtifacts: 1,
    }));
    const runner = new Runner(executor, { level: 2 });

    const step1 = await runner.step(mission);
    expect(step1.executedTaskId).toBe('a');
    mission = step1.state;

    const restored: MissionState = JSON.parse(JSON.stringify(mission));
    const step2 = await runner.step(restored);
    expect(step2.executedTaskId).toBe('b');
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('runner: enforces the per-step external call cap', async () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'heavy', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    const executor = async () => ({
      result: 'done' as const,
      externalCalls: MISSION_STEP_EXTERNAL_CAP + 10,
      outputArtifacts: 1,
    });
    const runner = new Runner(executor, { level: 2 });

    const outcome = await runner.step(mission);
    expect(outcome.state.history[0].result).toBe('failed');
    expect(outcome.state.history[0].error).toMatch(/40 external calls/);
  });

  it('runner: stops at iteration limit', async () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
      { id: 'b', description: 'B', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000, maxSteps: 1 });
    const executor = vi.fn(async () => ({
      result: 'done' as const,
      externalCalls: 1,
      outputArtifacts: 1,
    }));
    const runner = new Runner(executor, { level: 2 });

    const first = await runner.step(mission);
    expect(first.stopped).toBe(true);
    expect(first.stopReason).toBe('iteration-limit');
    expect(executor).toHaveBeenCalledTimes(0);
    // Verify step 0 was not executed
    expect(first.state.history.length).toBe(0);
  });

  it('runner: kill switch blocks execution', async () => {
    const goal = buildGoal('test', [
      { id: 'a', description: 'A', action: 'read', resource: 'web' },
    ]);
    const mission = createMission({ goal, startAt: 1000 });
    const executor = vi.fn(async () => ({
      result: 'done' as const,
      externalCalls: 0,
      outputArtifacts: 0,
    }));
    const runner = new Runner(executor, { level: 2, killSwitch: true });

    const outcome = await runner.step(mission);
    expect(outcome.stopReason).toBe('kill-switch');
    expect(executor).toHaveBeenCalledTimes(0);
  });

  it('runner: irreversible task requires approval, then runs', async () => {
    const goal = buildGoal('test', [
      {
        id: 'a',
        description: 'Delete something',
        action: 'delete',
        resource: 'tasks',
        permissionClass: 'write',
        irreversible: true,
      },
    ]);
    let mission = createMission({ goal, startAt: 1000 });
    const executor = vi.fn(async () => ({
      result: 'done' as const,
      externalCalls: 1,
      outputArtifacts: 1,
    }));
    const runner = new Runner(executor, { level: 2 });

    const step1 = await runner.step(mission);
    expect(step1.stopped).toBe(true);
    expect(step1.stopReason).toBe('permission-required');
    expect(step1.requiresApproval).toBe(true);
    expect(executor).toHaveBeenCalledTimes(0);

    mission = runner.approve(step1.state, 'a');
    const step2 = await runner.step(mission);
    expect(step2.executedTaskId).toBe('a');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('runner: MISSION_MAX_STEPS matches PRD 10.9', () => {
    expect(MISSION_MAX_STEPS).toBe(20);
  });

  // ---- One-sentence agent --------------------------------------------
  it('sentence: parses "Every Monday, tell me what changed in my project"', () => {
    const result = parseOneSentenceAgent(
      'Every Monday, tell me what changed in my project',
    );
    expect(result).not.toBeNull();
    expect(result!.schedule).toBe('0 9 * * 1');
    expect(result!.comparison).toBe('what changed');
    expect(result!.dataSource).toBe('my project');
    expect(result!.requiresConfirmation).toBe(true);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('sentence: parses "daily, notify me of new messages"', () => {
    const result = parseOneSentenceAgent('daily, notify me of new messages');
    expect(result).not.toBeNull();
    expect(result!.schedule).toBe('0 9 * * *');
    expect(result!.comparison).toBe('new');
    expect(result!.requiresConfirmation).toBe(true);
  });

  it('sentence: returns null for a non-schedule sentence', () => {
    expect(parseOneSentenceAgent('what time is it')).toBeNull();
  });

  // ---- Blueprint ------------------------------------------------------
  it('blueprint: validates a correct agent blueprint', () => {
    const bp = {
      id: 'bp-1',
      name: 'Research Monday',
      description: 'Weekly research',
      version: '1.0.0',
      schemaVersion: 1,
      goalDescription: 'every Monday, what changed in my project',
      tasks: [
        {
          id: 't1',
          description: 'Fetch project page',
          action: 'read',
          resource: 'web',
          permissionClass: 'read',
          dependsOn: [],
          irreversible: false,
        },
      ],
    };
    const result = validateAgentBlueprint(bp);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('blueprint: rejects executable content (L9)', () => {
    const bp = {
      id: 'bp-x',
      name: 'Malicious',
      description: 'eval("process.exit()")',
      version: '1.0.0',
      schemaVersion: 1,
      goalDescription: 'bad',
      tasks: [],
    };
    const result = validateAgentBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /security violation/i.test(e))).toBe(true);
  });

  it('blueprint: converts to a Goal', () => {
    const bp = {
      id: 'bp-1',
      name: 'Weekly',
      description: 'Weekly research',
      version: '1.0.0',
      schemaVersion: 1 as const,
      goalDescription: 'monitor project',
      tasks: [
        {
          id: 't1',
          description: 'Fetch',
          action: 'read',
          resource: 'web',
          permissionClass: 'read' as const,
          dependsOn: [],
          irreversible: false,
        },
      ],
    };
    const goal = blueprintToGoal(bp);
    expect(goal.description).toBe('monitor project');
    expect(goal.tasks.length).toBe(1);
    expect(goal.tasks[0].status).toBe('pending');
  });
});