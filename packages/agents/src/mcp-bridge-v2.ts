// === FILE START ===
// packages/agents/src/mcp-bridge-v2.ts
// PRD §14.8 · FR-DEV-04 · T-13.
//
// MCP tool-source bridge. PRD §14.8:
//
//   "MCP support: Later, as a tool source with the same permission matrix."
//
// An MCP server is described by a declarative manifest: endpoint + a list of
// tools, each with its own permission class, input JSON schema, and a short
// description. Tools are gated by the same permission matrix that governs
// first-party tools (Section 10.3 / 12.4). A tool is only "available" when
// the caller's matrix allows its declared permission.
//
// The validator enforces:
//   · endpoint must be https (no plain http, no localhost in the spec)
//   · the host must not look like SSRF-bait (private ranges, metadata IPs)
//   · no executable content anywhere in the manifest (same recursive check
//     as plugins-v2.ts)
//   · every tool must declare a permission from the known set
//
// Zero external imports.

export type ToolPermission =
  | 'read:web'
  | 'read:file'
  | 'write:file'
  | 'send'
  | 'delete'
  | 'run';

export type PermissionMatrix = Readonly<Record<string, ToolPermission[]>>;

export interface McpToolSpec {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: Record<string, unknown>;
}

export interface McpServerSpec {
  id: string;
  name: string;
  endpoint: string;
  tools: McpToolSpec[];
}

export type McpValidation =
  | { ok: true; server: McpServerSpec }
  | { ok: false; error: string };

const PERMISSIONS: readonly ToolPermission[] = [
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

const SSRF_BAIT_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  '10.',
  '192.168.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
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
      return `${path}.${k} is forbidden: MCP manifests are data, never code`;
    }
    const inner = findForbiddenKey(
      (value as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (inner !== null) return inner;
  }
  return null;
}

function looksLikeSsrfBait(endpoint: string): string | null {
  if (!endpoint.startsWith('https://')) {
    return `endpoint must be https, got: ${endpoint}`;
  }
  const afterScheme = endpoint.slice('https://'.length);
  const slash = afterScheme.indexOf('/');
  const hostPort = slash === -1 ? afterScheme : afterScheme.slice(0, slash);
  const host = hostPort.split(':')[0] ?? '';

  for (const bait of SSRF_BAIT_HOSTS) {
    if (host === bait || host.startsWith(bait)) {
      return `endpoint host is SSRF-bait: ${host}`;
    }
  }
  return null;
}

export function validateMcpServer(input: unknown): McpValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'MCP server must be a plain object' };
  }
  const forbidden = findForbiddenKey(input, 'mcpServer');
  if (forbidden !== null) return { ok: false, error: forbidden };

  const obj = input as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (typeof obj['endpoint'] !== 'string') {
    return { ok: false, error: 'endpoint must be a string' };
  }
  const ssrfErr = looksLikeSsrfBait(obj['endpoint']);
  if (ssrfErr !== null) return { ok: false, error: ssrfErr };

  if (!Array.isArray(obj['tools'])) {
    return { ok: false, error: 'tools must be an array' };
  }
  const tools: McpToolSpec[] = [];
  for (let i = 0; i < obj['tools'].length; i++) {
    const raw = obj['tools'][i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: `tools[${i}] must be a plain object` };
    }
    const t = raw as Record<string, unknown>;
    if (typeof t['name'] !== 'string' || t['name'].length === 0) {
      return {
        ok: false,
        error: `tools[${i}].name must be a non-empty string`,
      };
    }
    if (typeof t['description'] !== 'string') {
      return {
        ok: false,
        error: `tools[${i}].description must be a string`,
      };
    }
    if (
      typeof t['permission'] !== 'string' ||
      !(PERMISSIONS as readonly string[]).includes(t['permission'])
    ) {
      return {
        ok: false,
        error: `tools[${i}].permission must be one of: ${PERMISSIONS.join(', ')}`,
      };
    }
    if (
      t['inputSchema'] === null ||
      typeof t['inputSchema'] !== 'object' ||
      Array.isArray(t['inputSchema'])
    ) {
      return {
        ok: false,
        error: `tools[${i}].inputSchema must be a plain object`,
      };
    }
    tools.push({
      name: t['name'] as string,
      description: t['description'] as string,
      permission: t['permission'] as ToolPermission,
      inputSchema: { ...(t['inputSchema'] as Record<string, unknown>) },
    });
  }

  return {
    ok: true,
    server: {
      id: obj['id'] as string,
      name: obj['name'] as string,
      endpoint: obj['endpoint'] as string,
      tools,
    },
  };
}

export function isToolAvailable(
  server: McpServerSpec,
  toolName: string,
  matrix: PermissionMatrix,
): boolean {
  const tool = server.tools.find((t) => t.name === toolName);
  if (tool === undefined) return false;
  const callerPerms = matrix['*'] ?? [];
  return callerPerms.includes(tool.permission);
}

export function enumerateAvailable(
  server: McpServerSpec,
  matrix: PermissionMatrix,
): McpToolSpec[] {
  const callerPerms = matrix['*'] ?? [];
  return server.tools.filter((t) => callerPerms.includes(t.permission));
}
// === FILE END ===