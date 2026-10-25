// packages/memory-curator/src/store.ts
// In-memory store. The production store lives in IndexedDB (Appendix D.1);
// the curator only needs this interface for the pipeline and tests.

import type { Memory } from './types.js';

export class MemoryStore {
  private readonly byId = new Map<string, Memory>();
  private readonly byUser = new Map<string, Set<string>>();

  add(memory: Memory): void {
    this.byId.set(memory.id, memory);
    let set = this.byUser.get(memory.userId);
    if (!set) {
      set = new Set();
      this.byUser.set(memory.userId, set);
    }
    set.add(memory.id);
  }

  get(id: string): Memory | undefined {
    const memory = this.byId.get(id);
    return memory ? { ...memory } : undefined;
  }

  list(userId: string): Memory[] {
    const ids = this.byUser.get(userId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.byId.get(id))
      .filter((m): m is Memory => m !== undefined)
      .map((m) => ({ ...m }));
  }

  listActive(userId: string): Memory[] {
    return this.list(userId).filter((m) => m.status === 'active');
  }

  update(id: string, patch: Partial<Memory>): Memory | undefined {
    const existing = this.byId.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }

  count(userId?: string): number {
    if (!userId) return this.byId.size;
    return this.byUser.get(userId)?.size ?? 0;
  }

  clear(): void {
    this.byId.clear();
    this.byUser.clear();
  }
}