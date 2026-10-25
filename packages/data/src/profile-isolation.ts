// === FILE START ===
// packages/data/src/profile-isolation.ts
// PRD 12.6 · FR-PROF-01 · T-19.
//
// Profile isolation. Profile A must never read or write profile B's
// store, D1 rows or Durable Object state.
//
// The ScopedStore carries the profileId it was created for. Every
// operation takes an optional `asProfileId` argument that defaults to the
// scope's own profileId. Any call with a different id throws
// IsolationViolation BEFORE the underlying store is touched.
//
// Zero-trust: the scope is the *only* path to the store. If a caller
// bypasses ScopedStore and holds the raw store reference, isolation is
// their responsibility — the module's contract is that the scoped API is
// the only officially supported entry point.

import type { Identifiable } from './import-package.js';

export class IsolationViolation extends Error {
  readonly kind = 'IsolationViolation';
  readonly scopeProfileId: string;
  readonly attemptedProfileId: string;
  readonly operation: string;
  constructor(
    scopeProfileId: string,
    attemptedProfileId: string,
    operation: string,
  ) {
    super(
      `Profile isolation violation: scope=${scopeProfileId} attempted=${attemptedProfileId} op=${operation}`,
    );
    this.scopeProfileId = scopeProfileId;
    this.attemptedProfileId = attemptedProfileId;
    this.operation = operation;
  }
}

export interface RawStore {
  /** Rows keyed by profileId. In D1 these are separate rows; here we model it in-memory. */
  rows: Map<string, Identifiable[]>;
}

export function createRawStore(): RawStore {
  return { rows: new Map() };
}

export class ScopedStore {
  private readonly store: RawStore;
  readonly profileId: string;

  constructor(store: RawStore, profileId: string) {
    if (typeof profileId !== 'string' || profileId.length === 0) {
      throw new Error('ScopedStore: profileId must be a non-empty string');
    }
    this.store = store;
    this.profileId = profileId;
  }

  private assertOwnership(attemptedProfileId: string, operation: string): void {
    if (attemptedProfileId !== this.profileId) {
      throw new IsolationViolation(this.profileId, attemptedProfileId, operation);
    }
  }

  read(asProfileId: string = this.profileId): Identifiable[] {
    this.assertOwnership(asProfileId, 'read');
    const rows = this.store.rows.get(this.profileId) ?? [];
    return rows.map((r) => ({ ...r }));
  }

  write(
    rows: Identifiable[],
    asProfileId: string = this.profileId,
  ): void {
    this.assertOwnership(asProfileId, 'write');
    this.store.rows.set(this.profileId, rows.map((r) => ({ ...r })));
  }

  append(
    row: Identifiable,
    asProfileId: string = this.profileId,
  ): void {
    this.assertOwnership(asProfileId, 'append');
    const current = this.store.rows.get(this.profileId) ?? [];
    const exists = current.some((r) => r.id === row.id);
    if (exists) {
      throw new Error(
        `ScopedStore.append: id ${row.id} already exists in profile ${this.profileId}`,
      );
    }
    this.store.rows.set(this.profileId, [...current, { ...row }]);
  }

  find(
    id: string,
    asProfileId: string = this.profileId,
  ): Identifiable | null {
    this.assertOwnership(asProfileId, 'find');
    const current = this.store.rows.get(this.profileId) ?? [];
    const hit = current.find((r) => r.id === id);
    return hit ? { ...hit } : null;
  }
}
// === FILE END ===