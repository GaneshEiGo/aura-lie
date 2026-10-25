// packages/marketplace/src/types.ts
// PRD 14.7 / F-236: shared files in a community folder.
// Only three kinds. Always declarative. Never executable (L9).

export type MarketplaceItemKind = 'blueprint' | 'persona' | 'workflow';

export interface MarketplaceItem<T = unknown> {
  id: string;
  kind: MarketplaceItemKind;
  name: string;
  description: string;
  version: string;
  author?: string;
  schemaVersion: 1;
  content: T;
  checksum: string;
  createdAt: number;
  approved: boolean;
}

export interface ReviewResult {
  approved: boolean;
  errors: string[];
  warnings: string[];
}

export interface InstallOptions {
  profileId?: string;
  permissions?: {
    allowNetwork?: boolean;
    allowTools?: boolean;
    allowMemoryRead?: boolean;
    allowMemoryWrite?: boolean;
  };
}

export interface InstallResult {
  installed: boolean;
  reason?: string;
  itemId?: string;
}

export interface MarketplaceIndex {
  items: MarketplaceItem[];
  lastSyncAt: number;
  counts: Record<MarketplaceItemKind, number>;
}