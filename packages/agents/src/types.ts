export type MissionStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'NEEDS_APPROVAL';

export interface MissionStep {
  id: string;
  description: string;
  toolId?: string;
  toolInput?: any;
  requiresApproval: boolean;
}

export interface Mission {
  id: string;
  goal: string;
  steps: MissionStep[];
  cursor: number;
  status: MissionStatus;
  maxSteps: number;
  timeoutMs: number;
  startedAt?: number;
}

export interface MissionResult {
  missionId: string;
  status: MissionStatus;
  completedSteps: number;
  error?: string;
}