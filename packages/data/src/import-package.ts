// === FILE START ===
// packages/data/src/import-package.ts
// PRD 9.9 · FR-DATA-02 · T-18.
//
// Import a Full export back into a store. Two-phase:
//
//   1. previewImport(existing, pkg) — returns an ImportPreview with
//      counts and conflicts. Never mutates.
//   2. applyImport(existing, preview, opts) — merges per the caller's
//      conflict strategy. Returns the new store state (immutable input).
//
// Conflict strategies (per PRD 9.9 "preview and dry run"):
//   · 'keep-local'     — existing row wins on id conflict
//   · 'keep-imported'  — imported row wins on id conflict
//   · 'keep-both'      — both rows survive; imported one gets id suffixed
//
// The store shape is deliberately loose: any objects with an `id` field.
// This keeps the module reusable for memories, messages, claims, sources,
// audit rows, personas, and settings (settings is a singleton, merged).

import type { ExportPackage } from './export-profiles.js';

export type ConflictStrategy =
  | 'keep-local'
  | 'keep-imported'
  | 'keep-both';

export interface ImportOptions {
  conflict: ConflictStrategy;
}

export interface Identifiable {
  id: string;
  [key: string]: unknown;
}

export interface MergeableStore {
  messages: Identifiable[];
  claims: Identifiable[];
  sources: Identifiable[];
  memories: Identifiable[];
  auditLog: Identifiable[];
  settings: Record<string, unknown>;
  personas: Identifiable[];
}

export interface FieldConflict {
  collection: keyof MergeableStore | 'settings';
  id: string;
  local: unknown;
  imported: unknown;
}

export interface ImportPreview {
  pkg: ExportPackage;
  newCounts: Record<keyof MergeableStore, number>;
  conflictCounts: Record<keyof MergeableStore, number>;
  conflicts: FieldConflict[];
  settingsChanged: boolean;
}

function toMap(items: Identifiable[]): Map<string, Identifiable> {
  const map = new Map<string, Identifiable>();
  for (const item of items) map.set(item.id, item);
  return map;
}

const COLLECTIONS: ReadonlyArray<keyof MergeableStore> = [
  'messages',
  'claims',
  'sources',
  'memories',
  'auditLog',
  'personas',
];

function emptyCounts(): Record<keyof MergeableStore, number> {
  return {
    messages: 0,
    claims: 0,
    sources: 0,
    memories: 0,
    auditLog: 0,
    personas: 0,
    settings: 0,
  };
}

export function previewImport(
  existing: MergeableStore,
  pkg: ExportPackage,
): ImportPreview {
  const incoming = pkg.data as Partial<MergeableStore>;
  const newCounts = emptyCounts();
  const conflictCounts = emptyCounts();
  const conflicts: FieldConflict[] = [];

  for (const coll of COLLECTIONS) {
    const localItems = existing[coll] as Identifiable[];
    const incomingItems = (incoming[coll] as Identifiable[] | undefined) ?? [];
    const localById = toMap(localItems);
    for (const item of incomingItems) {
      if (localById.has(item.id)) {
        conflictCounts[coll] += 1;
        conflicts.push({
          collection: coll,
          id: item.id,
          local: localById.get(item.id),
          imported: item,
        });
      } else {
        newCounts[coll] += 1;
      }
    }
  }

  const incomingSettings = (incoming.settings ?? {}) as Record<string, unknown>;
  const settingsChanged =
    JSON.stringify(existing.settings ?? {}) !== JSON.stringify(incomingSettings);

  return {
    pkg,
    newCounts,
    conflictCounts,
    conflicts,
    settingsChanged,
  };
}

function mergeCollection(
  local: Identifiable[],
  imported: Identifiable[],
  strategy: ConflictStrategy,
): Identifiable[] {
  const localById = toMap(local);
  const out: Identifiable[] = [...local];
  for (const item of imported) {
    if (!localById.has(item.id)) {
      out.push(item);
      continue;
    }
    if (strategy === 'keep-local') continue;
    if (strategy === 'keep-imported') {
      const idx = out.findIndex((r) => r.id === item.id);
      if (idx !== -1) out[idx] = item;
      continue;
    }
    // keep-both — imported gets a suffix
    let n = 1;
    let newId = `${item.id}~imported-${n}`;
    while (out.some((r) => r.id === newId)) {
      n += 1;
      newId = `${item.id}~imported-${n}`;
    }
    out.push({ ...item, id: newId });
  }
  return out;
}

export function applyImport(
  existing: MergeableStore,
  preview: ImportPreview,
  opts: ImportOptions,
): MergeableStore {
  const incoming = preview.pkg.data as Partial<MergeableStore>;
  const next: MergeableStore = {
    messages: mergeCollection(
      existing.messages,
      (incoming.messages as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    claims: mergeCollection(
      existing.claims,
      (incoming.claims as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    sources: mergeCollection(
      existing.sources,
      (incoming.sources as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    memories: mergeCollection(
      existing.memories,
      (incoming.memories as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    auditLog: mergeCollection(
      existing.auditLog,
      (incoming.auditLog as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    personas: mergeCollection(
      existing.personas,
      (incoming.personas as Identifiable[] | undefined) ?? [],
      opts.conflict,
    ),
    settings: preview.settingsChanged
      ? ((incoming.settings as Record<string, unknown> | undefined) ?? {})
      : existing.settings,
  };
  return next;
}
// === FILE END ===