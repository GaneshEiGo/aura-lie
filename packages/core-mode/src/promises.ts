import type { PromiseItem } from './types.js';

export class PromiseQueue {
  private queue: PromiseItem[] = [];
  private fulfilledCount = 0;
  private failedCount = 0;

  public enqueue(request: string, earliestResumeAt: number): string {
    const id = crypto.randomUUID();
    this.queue.push({
      id,
      request,
      createdAt: Date.now(),
      earliestResumeAt,
      status: 'queued'
    });
    return id;
  }

  public getPending(): PromiseItem[] {
    return [...this.queue];
  }

  public resume(id: string, success: boolean): void {
    const index = this.queue.findIndex(p => p.id === id);
    if (index === -1) return;

    const item = this.queue[index];
    item.status = success ? 'fulfilled' : 'failed';
    
    if (success) this.fulfilledCount++;
    else this.failedCount++;

    this.queue.splice(index, 1);
  }

  /**
   * PRD §7.8: Promise-keep rate must be 100% for fulfilled items.
   */
  public getKeepRate(): number {
    const total = this.fulfilledCount + this.failedCount;
    if (total === 0) return 100;
    return (this.fulfilledCount / total) * 100;
  }
}