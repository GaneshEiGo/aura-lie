import type { Mode, Sensitivity } from '@aura-lie/shared';
import type { ModelInfo } from '@aura-lie/router';

export interface OrchestratorRequest {
  query: string;
  mode: Mode;
  userId: string;
  sessionId: string;
}

export interface RouteContext {
  model: ModelInfo;
  sensitivity: Sensitivity;
  riskTier: number;
  purpose: 'interactive' | 'background';
}