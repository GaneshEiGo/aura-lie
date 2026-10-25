// === FILE START ===
// packages/agents/test/mcp-bridge-v2.test.ts
// PRD §14.8 · FR-DEV-04.

import { describe, it, expect } from 'vitest';
import {
  validateMcpServer,
  isToolAvailable,
  enumerateAvailable,
  type McpServerSpec,
  type PermissionMatrix,
} from '../src/mcp-bridge-v2.js';

function goodServer(): McpServerSpec {
  return {
    id: 'wiki-mcp',
    name: 'Wikipedia MCP',
    endpoint: 'https://wiki.example.com/mcp',
    tools: [
      {
        name: 'search',
        description: 'Search Wikipedia',
        permission: 'read:web',
        inputSchema: { type: 'object' },
      },
      {
        name: 'create_note',
        description: 'Create a note',
        permission: 'write:file',
        inputSchema: { type: 'object' },
      },
    ],
  };
}

describe('mcp-bridge — validation accepts good data', () => {
  it('accepts a well-formed server with two tools', () => {
    const r = validateMcpServer(goodServer());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.server.id).toBe('wiki-mcp');
    expect(r.server.tools.length).toBe(2);
  });

  it('accepts a server with zero tools', () => {
    const r = validateMcpServer({ ...goodServer(), tools: [] });
    expect(r.ok).toBe(true);
  });
});

describe('mcp-bridge — endpoint validation', () => {
  it('rejects a plain http endpoint', () => {
    const r = validateMcpServer({ ...goodServer(), endpoint: 'http://wiki.example.com/mcp' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
  });

  it('rejects localhost', () => {
    const r = validateMcpServer({ ...goodServer(), endpoint: 'https://localhost/mcp' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('SSRF');
  });

  it('rejects the cloud-metadata IP', () => {
    const r = validateMcpServer({
      ...goodServer(),
      endpoint: 'https://169.254.169.254/latest/meta-data',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a 10.0.0.0/8 private-range host', () => {
    const r = validateMcpServer({ ...goodServer(), endpoint: 'https://10.0.0.1/mcp' });
    expect(r.ok).toBe(false);
  });
});

describe('mcp-bridge — executable-content rejection', () => {
  it('rejects a "code" key inside a tool inputSchema', () => {
    const server = goodServer();
    (server.tools[0]!.inputSchema as Record<string, unknown>)['code'] = 'console.log(1)';
    const r = validateMcpServer(server);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });

  it('rejects a tool with an unknown permission', () => {
    const server = goodServer();
    (server.tools[0] as unknown as Record<string, unknown>)['permission'] = 'root:everything';
    const r = validateMcpServer(server);
    expect(r.ok).toBe(false);
  });
});

describe('mcp-bridge — permission matrix', () => {
  const readOnlyMatrix: PermissionMatrix = { '*': ['read:web'] };
  const fullMatrix: PermissionMatrix = {
    '*': ['read:web', 'read:file', 'write:file', 'send', 'delete', 'run'],
  };

  it('isToolAvailable reflects the matrix', () => {
    const server = goodServer();
    expect(isToolAvailable(server, 'search', readOnlyMatrix)).toBe(true);
    expect(isToolAvailable(server, 'create_note', readOnlyMatrix)).toBe(false);
    expect(isToolAvailable(server, 'create_note', fullMatrix)).toBe(true);
  });

  it('isToolAvailable returns false for an unknown tool name', () => {
    expect(isToolAvailable(goodServer(), 'nope', fullMatrix)).toBe(false);
  });

  it('enumerateAvailable returns only permitted tools', () => {
    const server = goodServer();
    const names = enumerateAvailable(server, readOnlyMatrix).map((t) => t.name);
    expect(names).toEqual(['search']);
    const names2 = enumerateAvailable(server, fullMatrix).map((t) => t.name).sort();
    expect(names2).toEqual(['create_note', 'search']);
  });
});

describe('mcp-bridge — source scan', () => {
  it('source scan: mcp-bridge-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'mcp-bridge-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===