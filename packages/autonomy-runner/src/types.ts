// packages/autonomy-runner/src/types.ts
// PRD 10.9, 10.2, 10.3, 10.4, FR-AGENT-01..08.

export type PermissionClass = 'read' | 'write' | 'send' | 'delete' | 'execute';
export type PermissionDecision = 'allow' | 'ask' | 'never';
export type AutonomyLevel = 0 | 1 | 2 | 3;

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface Task {
  id: string;
  description: string;
  dependsOn: string[];
  action: string;
  resource: string; // 'memory' | 'tasks' | 'web' | ...
  permissionClass: PermissionClass;
  irreversible: boolean;
  status: TaskStatus;
  approval: ApprovalStatus;
}

export interface Goal {
  id: string;
  description: string;
  tasks: Task[];
  createdAt: number;
}

export type StopReason =
  | 'kill-switch'
  | 'iteration-limit'
  | 'time-limit'
  | 'goal-achieved'
  | 'evidence-sufficient'
  | 'unresolved-contradiction'
  | 'permission-required'
  | 'no-progress';

export interface MissionStep {
  index: number;
  taskId: string;
  action: string;
  result: 'done' | 'failed' | 'skipped';
  externalCalls: number;
  at: number;
  outputArtifacts: number;
  error?: string;
}

export interface HandoffPayload {
  claims?: Array<{ id: string; text: string; status: string }>;
  sources?: Array<{ id: string; url: string; title?: string }>;
  contradictions?: Array<{
    claimA: string;
    claimB: string;
    resolved: boolean;
    note?: string;
  }>;
  notes?: string;
}

export interface MissionState {
  id: string;
  goal: Goal;
  step: number;
  maxSteps: number;
  deadlineAt?: number;
  startAt: number;
  status: 'running' | 'stopped' | 'done';
  stopReason?: StopReason;
  history: MissionStep[];
  handoff: HandoffPayload;
  callBudget: { used: number; total: number };
  noProgressWindow: number;
}

export interface StepExecutorResult {
  result: 'done' | 'failed' | 'skipped';
  externalCalls: number;
  outputArtifacts: number;
  error?: string;
  handoff?: Partial<HandoffPayload>;
}

export type StepExecutor = (
  task: Task,
  mission: MissionState,
) => Promise<StepExecutorResult>;

export interface RunnerOptions {
  clock?: { now(): number };
  killSwitch?: boolean;
  level?: AutonomyLevel;
  perStepExternalCallCap?: number;
  evidenceSourceRequirement?: number;
}

export interface StepOutcome {
  state: MissionState;
  stopped: boolean;
  stopReason?: StopReason;
  requiresApproval?: boolean;
  executedTaskId?: string;
}

export interface DryRunPlan {
  reads: string[];
  writes: string[];
  searches: string[];
  outputs: string[];
  noExternalActions: true;
  estimatedCalls: number;
  requiresApproval: boolean;
}

export interface OneSentenceAgent {
  schedule: string;
  dataSource: string;
  comparison: string;
  notification: string;
  raw: string;
  confidence: number;
  requiresConfirmation: true;
}

// PRD 10.9: "at most 20 steps"
export const MISSION_MAX_STEPS = 20;

// PRD 10.9: "≤ 40 external calls/step"
export const MISSION_STEP_EXTERNAL_CAP = 40;

// PRD 10.2: background "energy" budgets per level
export const ENERGY_BUDGET: Record<AutonomyLevel, number> = {
  0: 0,
  1: 10,
  2: 40,
  3: 60,
};

// PRD 10.9: rolling window for "no useful progress"
export const NO_PROGRESS_WINDOW = 3;

// PRD 10.3: base permission matrix
export const DEFAULT_PERMISSION_MATRIX: Record<
  string,
  Partial<Record<PermissionClass, PermissionDecision>>
> = {
  memory: { read: 'allow', write: 'allow', send: 'never', delete: 'ask' },
  'project-files': { read: 'allow', write: 'allow', send: 'never', delete: 'ask' },
  web: { read: 'allow', write: 'never', send: 'never', delete: 'never' },
  calendar: { read: 'allow', write: 'allow', send: 'never', delete: 'ask' },
  tasks: { read: 'allow', write: 'allow', send: 'never', delete: 'ask' },
  notifications: { read: 'allow', write: 'allow', send: 'allow', delete: 'never' },
  messages: { read: 'allow', write: 'never', send: 'never', delete: 'never' },
  code: { read: 'allow', write: 'never', send: 'never', delete: 'never' },
  email: { read: 'never', write: 'never', send: 'never', delete: 'never' },
  payments: { read: 'never', write: 'never', send: 'never', delete: 'never' },
  settings: { read: 'allow', write: 'ask', send: 'never', delete: 'never' },
};

// PRD 10.9: "Harmless operations (create a document, add a task, save a draft)
// run without asking at Level 2 and above."
export const HARMLESS_WRITE_RESOURCES = [
  'memory',
  'tasks',
  'notifications',
  'project-files',
  'calendar',
];