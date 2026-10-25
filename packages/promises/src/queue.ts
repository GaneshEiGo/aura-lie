import type { QueuedRequest, PromiseResult } from './types.js';

export class PromiseQueue {
  private queue: QueuedRequest[] = [];
  private completed: PromiseResult[] = [];

  public enqueue(message: string, mode: string, persona: string): QueuedRequest {
    const request: QueuedRequest = {
      id: crypto.randomUUID(),
      message,
      mode,
      persona,
      timestamp: Date.now(),
      retryCount: 0
    };
    this.queue.push(request);
    return request;
  }

  public dequeue(): QueuedRequest | undefined {
    return this.queue.shift();
  }

  public getPending(): ReadonlyArray<QueuedRequest> {
    return this.queue;
  }

  public getCompleted(): ReadonlyArray<PromiseResult> {
    return this.completed;
  }

  public resolve(requestId: string, response: string): void {
    const exists = this.queue.some(r => r.id === requestId);
    if (!exists) return; // Prevent resolving non-existent requests

    this.completed.push({
      requestId,
      response,
      completedAt: Date.now()
    });
    this.queue = this.queue.filter(r => r.id !== requestId);
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}