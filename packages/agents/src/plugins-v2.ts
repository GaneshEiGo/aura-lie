// === FILE START ===
// packages/agents/src/plugins-v2.ts
// PRD §14.8 · FR-DEV-02 · T-13.
//
// Declarative plugin manifest. PRD §14.8 is explicit:
//
//   "Tools, personas, model adapters and agent templates as manifests, not
//    arbitrary code. A plugin can describe an HTTP tool and its schema. No
//    code runs in the Worker from plugins."
//
// The validator walks the entire manifest and rejects any key that could be
// interpreted as executable content: `code`, `exec`, `execute`, `eval`,
// `script`, `function`, `fn`, `run`, `require`, `import`, `fetch`. This is
// the same defence `blueprints-v2.ts` applies to blueprints, extended to
// plugins and their nested schemas.
//
// Zero external imports.

export type PluginKind = 'tool' | 'persona' | 'adapter' | 'template' | 'widget';

export type Permission =
  | 'read:web'
  | 'read:file'
  | 'write:file'
  | 'send'
  | 'delete'
  | 'run';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description: string;
  permissions: Permission[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export type PluginValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

const KINDS: readonly PluginKind[] = [
  'tool',
  'persona',
  'adapter',
  'template',
  'widget',
];

const PERMISSIONS: readonly Permission[] = [
  'read:web',
  'read:file',
  'write:file',
  'send',
  'delete',
  'run',
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
      return `${path}.${k} is forbidden: plugins are data, never code`;
    }
    const inner = findForbiddenKey(
      (value as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (inner !== null) return inner;
  }
  return null;
}

export function validatePlugin(input: unknown): PluginValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'plugin must be a plain object' };
  }
  const forbidden = findForbiddenKey(input, 'plugin');
  if (forbidden !== null) return { ok: false, error: forbidden };

  const obj = input as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (typeof obj['version'] !== 'string' || obj['version'].length === 0) {
    return { ok: false, error: 'version must be a non-empty string' };
  }
  if (
    typeof obj['kind'] !== 'string' ||
    !(KINDS as readonly string[]).includes(obj['kind'])
  ) {
    return { ok: false, error: `kind must be one of: ${KINDS.join(', ')}` };
  }
  if (typeof obj['description'] !== 'string') {
    return { ok: false, error: 'description must be a string' };
  }
  if (!Array.isArray(obj['permissions'])) {
    return { ok: false, error: 'permissions must be an array' };
  }
  for (let i = 0; i < obj['permissions'].length; i++) {
    const p = obj['permissions'][i];
    if (
      typeof p !== 'string' ||
      !(PERMISSIONS as readonly string[]).includes(p)
    ) {
      return {
        ok: false,
        error: `permissions[${i}] must be one of: ${PERMISSIONS.join(', ')}`,
      };
    }
  }
  if (
    obj['inputSchema'] === null ||
    typeof obj['inputSchema'] !== 'object' ||
    Array.isArray(obj['inputSchema'])
  ) {
    return { ok: false, error: 'inputSchema must be a plain object' };
  }
  if (
    obj['outputSchema'] === null ||
    typeof obj['outputSchema'] !== 'object' ||
    Array.isArray(obj['outputSchema'])
  ) {
    return { ok: false, error: 'outputSchema must be a plain object' };
  }

  return {
    ok: true,
    manifest: {
      id: obj['id'] as string,
      name: obj['name'] as string,
      version: obj['version'] as string,
      kind: obj['kind'] as PluginKind,
      description: obj['description'] as string,
      permissions: [...(obj['permissions'] as Permission[])],
      inputSchema: { ...(obj['inputSchema'] as Record<string, unknown>) },
      outputSchema: { ...(obj['outputSchema'] as Record<string, unknown>) },
    },
  };
}

const registry: Map<string, PluginManifest> = new Map();

function clone(m: PluginManifest): PluginManifest {
  return {
    ...m,
    permissions: [...m.permissions],
    inputSchema: { ...m.inputSchema },
    outputSchema: { ...m.outputSchema },
  };
}

export function installPlugin(m: PluginManifest): void {
  registry.set(m.id, clone(m));
}

export function listPlugins(): PluginManifest[] {
  return Array.from(registry.values()).map(clone);
}

export function uninstallPlugin(id: string): boolean {
  return registry.delete(id);
}

export function clearRegistry(): void {
  registry.clear();
}

export function pluginHasPermission(
  m: PluginManifest,
  p: Permission,
): boolean {
  return m.permissions.includes(p);
}
// === FILE END ===