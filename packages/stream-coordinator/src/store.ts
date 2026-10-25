// packages/stream-coordinator/src/store.ts
// In-memory store — mirrors Durable Object SQLite storage shape.

import type { JobState, JobStore } from './types.js';

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobState>();

  get(id: string): JobState | undefined {
    const job = this.jobs.get(id);
    return job ? (deepClone(job) as JobState) : undefined;
  }

  put(job: JobState): void {
    this.jobs.set(job.id, deepClone(job) as JobState);
  }

  delete(id: string): void {
    this.jobs.delete(id);
  }

  list(): JobState[] {
    return Array.from(this.jobs.values()).map(
      (job) => deepClone(job) as JobState,
    );
  }

  size(): number {
    return this.jobs.size;
  }

  clear(): void {
    this.jobs.clear();
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}