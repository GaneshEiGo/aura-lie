// === FILE START ===
// packages/agents/src/marketplace-v2.ts
// PRD §14.7 · §14.8 · F-236 · T-13.
//
// Marketplace of shareable files. PRD §14.7:
//
//   "Marketplace: shared files in a community folder: personas, blueprints,
//    workflow templates. Reviewed, schema-validated, no executable content."
//
// Every entry is data. The validator walks the manifest recursively and
// rejects any key that could be interpreted as code: `code`, `exec`,
// `execute`, `eval`, `script`, `function`, `fn`, `run`, `require`, `import`,
// `fetch` — at any depth, in any object or array.
//
// Four kinds only: persona, blueprint, plugin, workflow. This is the same
// shape `blueprints-v2.ts` and `plugins-v2.ts` accept, reused here so a
// marketplace entry can be saved from any of them.
//
// Zero external imports.

export type MarketplaceKind = 'persona' | 'blueprint' | 'plugin' | 'workflow';

export interface MarketplaceEntry {
  id: string;
  kind: MarketplaceKind;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  payload: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true; entry: MarketplaceEntry }
  | { ok: false; error: string };

const KINDS: readonly MarketplaceKind[] = [
  'persona',
  'blueprint',
  'plugin',
  'workflow',
];

const FORBIDDEN_KEYS: readonly string[] = [
  'code',
  'exec',
  'execute',
  'eval',
  'script',
  'function',
  'fn',
  'run',
  'require',
  'import',
  'fetch',
];

function findForbiddenKey(value: unknown, path: string): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const inner = findForbiddenKey(value[i], `${path}[${i}]`);
      if (inner !== null) return inner;
    }
    return null;
  }
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(k.toLowerCase())) {
      return `${path}.${k} is forbidden: marketplace entries are data, never code`;
    }
    const inner = findForbiddenKey(
      (value as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (inner !== null) return inner;
  }
  return null;
}

export function validateMarketplaceEntry(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'marketplace entry must be a plain object' };
  }
  const forbidden = findForbiddenKey(input, 'entry');
  if (forbidden !== null) return { ok: false, error: forbidden };

  const obj = input as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (
    typeof obj['kind'] !== 'string' ||
    !(KINDS as readonly string[]).includes(obj['kind'])
  ) {
    return { ok: false, error: `kind must be one of: ${KINDS.join(', ')}` };
  }
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (typeof obj['version'] !== 'string' || obj['version'].length === 0) {
    return { ok: false, error: 'version must be a non-empty string' };
  }
  if (typeof obj['description'] !== 'string') {
    return { ok: false, error: 'description must be a string' };
  }
  if (typeof obj['author'] !== 'string' || obj['author'].length === 0) {
    return { ok: false, error: 'author must be a non-empty string' };
  }
  if (!Array.isArray(obj['tags'])) {
    return { ok: false, error: 'tags must be an array' };
  }
  for (let i = 0; i < obj['tags'].length; i++) {
    if (typeof obj['tags'][i] !== 'string') {
      return { ok: false, error: `tags[${i}] must be a string` };
    }
  }
  if (
    obj['payload'] === null ||
    typeof obj['payload'] !== 'object' ||
    Array.isArray(obj['payload'])
  ) {
    return { ok: false, error: 'payload must be a plain object' };
  }

  return {
    ok: true,
    entry: {
      id: obj['id'] as string,
      kind: obj['kind'] as MarketplaceKind,
      name: obj['name'] as string,
      version: obj['version'] as string,
      description: obj['description'] as string,
      author: obj['author'] as string,
      tags: [...(obj['tags'] as string[])],
      payload: { ...(obj['payload'] as Record<string, unknown>) },
    },
  };
}

const registry: Map<string, MarketplaceEntry> = new Map();

function clone(e: MarketplaceEntry): MarketplaceEntry {
  return {
    ...e,
    tags: [...e.tags],
    payload: { ...e.payload },
  };
}

export function saveMarketplaceEntry(entry: MarketplaceEntry): void {
  registry.set(entry.id, clone(entry));
}

export function listMarketplaceEntries(): MarketplaceEntry[] {
  return Array.from(registry.values()).map(clone);
}

export function filterMarketplaceEntries(filter: {
  kind?: MarketplaceKind;
  tag?: string;
}): MarketplaceEntry[] {
  return listMarketplaceEntries().filter((e) => {
    if (filter.kind !== undefined && e.kind !== filter.kind) return false;
    if (filter.tag !== undefined && !e.tags.includes(filter.tag)) return false;
    return true;
  });
}

export function clearMarketplaceRegistry(): void {
  registry.clear();
}

export function exportMarketplaceEntry(entry: MarketplaceEntry): string {
  return JSON.stringify(entry, null, 2);
}

export function importMarketplaceEntry(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  return validateMarketplaceEntry(parsed);
}
// === FILE END ===