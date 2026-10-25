export type Lane = 'private' | 'training-risk';
export type Role = 'chat_fast' | 'reasoner' | 'judge' | 'embed' | 'utility' | 'vision';

export interface ModelAdapter {
  id: string;
  provider: string;
  lane: Lane;
  roles: Role[];
  contextWindow: number;
  health: number; // 0 to 1
  costPer1kTokens: number; // 0 for free
}

export interface RouterRequest {
  role: Role;
  sensitivity: 'S0' | 'S1' | 'S2';
  promptLength: number;
  preferDiversity?: boolean; // For judges/red team
}

export interface RouteSelection {
  model: ModelAdapter;
  reason: string;
  fallbackChain: ModelAdapter[];
}

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterError';
  }
}