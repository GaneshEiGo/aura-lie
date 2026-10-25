// === FILE START ===
// packages/agents/test/rest-api-v2.test.ts
// PRD §14.6 · FR-DEV-05 · §13.1 · Appendix C.

import { describe, it, expect } from 'vitest';
import {
  ROUTES,
  matchRoute,
  buildOpenApi,
  type HttpMethod,
} from '../src/rest-api-v2.js';

describe('rest-api — route table', () => {
  it('every route has a method, path, auth, summary, and responseSchemaId', () => {
    for (const r of ROUTES) {
      expect(typeof r.method).toBe('string');
      expect(r.path.startsWith('/')).toBe(true);
      expect(['public', 'bearer']).toContain(r.auth);
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.responseSchemaId.length).toBeGreaterThan(0);
    }
  });

  it('/health is the only public route', () => {
    const publics = ROUTES.filter((r) => r.auth === 'public');
    expect(publics.length).toBe(1);
    expect(publics[0]!.path).toBe('/health');
  });

  it('route method+path pairs are unique', () => {
    const seen = new Set<string>();
    for (const r of ROUTES) {
      const key = `${r.method} ${r.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('rest-api — matchRoute happy paths', () => {
  it('matches GET /health', () => {
    const m = matchRoute('GET', '/health');
    expect(m).not.toBeNull();
    expect(m!.route.path).toBe('/health');
    expect(m!.params).toEqual({});
  });

  it('matches POST /v1/chat', () => {
    const m = matchRoute('POST', '/v1/chat');
    expect(m).not.toBeNull();
    expect(m!.route.requestSchemaId).toBe('ChatRequest');
  });

  it('matches GET /v1/chat/:id and captures id', () => {
    const m = matchRoute('GET', '/v1/chat/abc-123');
    expect(m).not.toBeNull();
    expect(m!.params['id']).toBe('abc-123');
  });

  it('matches DELETE /v1/memory/:id and captures id', () => {
    const m = matchRoute('DELETE', '/v1/memory/mem-42');
    expect(m).not.toBeNull();
    expect(m!.params['id']).toBe('mem-42');
  });

  it('matches GET /v1/missions/:id and captures id', () => {
    const m = matchRoute('GET', '/v1/missions/m-1');
    expect(m).not.toBeNull();
    expect(m!.params['id']).toBe('m-1');
  });
});

describe('rest-api — matchRoute rejections', () => {
  it('unknown path → null', () => {
    expect(matchRoute('GET', '/nope')).toBeNull();
  });

  it('wrong method on a known path → null', () => {
    expect(matchRoute('POST', '/health')).toBeNull();
    expect(matchRoute('GET', '/v1/chat')).toBeNull();
  });

  it('trailing segments break the match', () => {
    expect(matchRoute('GET', '/v1/chat/abc/extra')).toBeNull();
  });
});

describe('rest-api — OpenAPI document', () => {
  it('is OpenAPI 3.1.0 with the Aura-lie title', () => {
    const doc = buildOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Aura-lie API');
  });

  it('every route appears in paths with a lowercased method key', () => {
    const doc = buildOpenApi();
    for (const r of ROUTES) {
      const bucket = doc.paths[r.path];
      expect(bucket).toBeDefined();
      expect(bucket![r.method.toLowerCase()]).toBeDefined();
    }
  });

  it('bearer routes carry a security requirement', () => {
    const doc = buildOpenApi();
    const chat = doc.paths['/v1/chat']!['post']!;
    expect(chat.security.length).toBeGreaterThan(0);
    expect(chat.security[0]!['bearerAuth']).toBeDefined();
  });

  it('public routes have empty security', () => {
    const doc = buildOpenApi();
    const health = doc.paths['/health']!['get']!;
    expect(health.security).toEqual([]);
  });

  it('parameterised routes declare each parameter in the path', () => {
    const doc = buildOpenApi();
    const getChat = doc.paths['/v1/chat/:id']!['get']!;
    expect(getChat.parameters.length).toBe(1);
    expect(getChat.parameters[0]!.name).toBe('id');
    expect(getChat.parameters[0]!.in).toBe('path');
  });
});

describe('rest-api — source scan', () => {
  it('source scan: rest-api-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'rest-api-v2.ts'),
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