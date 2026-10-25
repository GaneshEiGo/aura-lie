export interface QueuedRequest {
  id: string;
  message: string;
  mode: string;
  persona: string;
  timestamp: number;
  retryCount: number;
}

export interface PromiseResult {
  requestId: string;
  response: string;
  completedAt: number;
}