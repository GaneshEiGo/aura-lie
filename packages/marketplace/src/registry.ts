// packages/marketplace/src/registry.ts
// Local-first community folder. No network. No server.

import type { MarketplaceIndex, MarketplaceItem, MarketplaceItemKind } from './types.js';

export class MarketplaceRegistry {
  private readonly items = new Map<string, MarketplaceItem>();

  add(item: MarketplaceItem): void {
    this.items.set(item.id, item);
  }

  get(id: string): MarketplaceItem | undefined {
    return this.items.get(id);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  list(filter?: {
    kind?: MarketplaceItemKind;
    approved?: boolean;
  }): MarketplaceItem[] {
    let all = Array.from(this.items.values());
    if (filter?.kind) {
      all = all.filter((i) => i.kind === filter.kind);
    }
    if (filter?.approved !== undefined) {
      all = all.filter((i) => i.approved === filter.approved);
    }
    return all;
  }

  index(): MarketplaceIndex {
    const items = this.list();
    return {
      items,
      lastSyncAt: Date.now(),
      counts: {
        blueprint: items.filter((i) => i.kind === 'blueprint').length,
        persona: items.filter((i) => i.kind === 'persona').length,
        workflow: items.filter((i) => i.kind === 'workflow').length,
      },
    };
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }
}