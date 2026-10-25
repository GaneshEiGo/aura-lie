// packages/permission-tools/src/types.ts
// PRD 10.3, 12.1, 12.4, FR-SEC-03, FR-TOOL-01..09, T-31.

export type PermissionClass = 'read' | 'write' | 'send' | 'delete' | 'execute';

export type PermissionDecision = 'allow' | 'ask' | 'never' | 'not_built';

/** PRD 10.3 exact resource list (10 resources + run-code = 11). */
export type Resource =
  | 'memory'
  | 'project-files'
  | 'web'
  | 'calendar'
  | 'tasks'
  | 'notifications'
  | 'messages'
  | 'code'
  | 'email'
  | 'payments'
  | 'settings';

export const ALL_RESOURCES: Resource[] = [
  'memory',
  'project-files',
  'web',
  'calendar',
  'tasks',
  'notifications',
  'messages',
  'code',
  'email',
  'payments',
  'settings',
];

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type TaintBehavior = 'adds_untrusted' | 'none';

/** One cell of the matrix. */
export interface MatrixCell {
  decision: PermissionDecision;
  /** PRD 9.5: S2 memory writes need explicit approval. */
  s2RequiresAsk?: boolean;
  /** PRD 10.3: notifications "allow within caps" — the caller still enforces caps. */
  onlyWithinCaps?: boolean;
  /** PRD 10.3: run code = "ask once per session". */
  askOncePerSession?: boolean;
}

export type MatrixRow = Partial<Record<PermissionClass, MatrixCell>>;

export type PermissionMatrix = Record<Resource, MatrixRow>;

/** The 10.9 rule: harmless writes run without asking at Level 2+. */
export const HARMLESS_WRITE_RESOURCES: Resource[] = [
  'memory',
  'project-files',
  'calendar',
  'tasks',
  'notifications',
];

/** PRD 12.1: tool manifest. */
export interface ToolManifest {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** e.g. ['read:web', 'write:tasks'] */
  permissions: string[];
  risk: RiskLevel;
  quotaPool: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  tainting: TaintBehavior;
}

export interface ParsedPermission {
  cls: PermissionClass;
  resource: Resource;
}

export interface PermissionCheck {
  permission: string;
  cls: PermissionClass;
  resource: Resource;
  decision: PermissionDecision;
  requiresApproval: boolean;
  reason: string;
}

export interface EnforceContext {
  level: 0 | 1 | 2 | 3;
  sensitivity: 'S0' | 'S1' | 'S2';
  /** PRD 12.4: turn has external content from a prior tool. */
  tainted: boolean;
  session: import('./session.js').SessionContext;
}

export interface EnforceResult {
  tool: string;
  checks: PermissionCheck[];
  allowed: boolean;
  requiresApproval: boolean;
  requiresConfirmation: boolean;
  blockedBy?: string;
  /** FR-TOOL-08: a dry-run always reports this literal `true`. */
  noExternalActions: true;
  /** FR-TOOL-08: summary of side effects the tool WOULD cause. */
  dryRun: DryRunSummary;
}

export interface DryRunSummary {
  wouldRead: boolean;
  wouldWrite: boolean;
  wouldSend: boolean;
  wouldDelete: boolean;
  wouldExecute: boolean;
  quotaPool: string | null;
  estimatedRisk: RiskLevel;
}

export interface RegisterResult {
  ok: boolean;
  errors: string[];
}

export const VALID_PERMISSION_CLASSES: PermissionClass[] = [
  'read',
  'write',
  'send',
  'delete',
  'execute',
];

export const VALID_RISK_LEVELS: RiskLevel[] = ['none', 'low', 'medium', 'high'];