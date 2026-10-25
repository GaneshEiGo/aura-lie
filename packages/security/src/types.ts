export type Lane = 'private' | 'training-risk';
export type Sensitivity = 'S0' | 'S1' | 'S2';

export interface SecurityContext {
  sessionId: string;
  userId: string;
  sensitivity: Sensitivity;
  allowedLanes: Lane[];
  isTainted: boolean; // True if external untrusted content is in the prompt
}

export class SecurityError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class CostGuardViolation extends SecurityError {
  constructor(host: string) {
    super('COST_GUARD_VIOLATION', `Blocked outbound request to unauthorized host: ${host}`);
  }
}

export class SensitivityViolation extends SecurityError {
  constructor(lane: Lane, sensitivity: Sensitivity) {
    super('SENSITIVITY_VIOLATION', `Cannot send ${sensitivity} data to ${lane} lane.`);
  }
}