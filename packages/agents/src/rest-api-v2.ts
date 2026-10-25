// === FILE START ===
// packages/agents/src/rest-api-v2.ts
// PRD §14.6 · FR-DEV-05 · §13.1 · Appendix C.
//
// The authenticated REST API surface. This module is the *manifest* and the
// *matcher*: it declares every route, the auth requirement, and the JSON
// schema of its request and response. A caller (Worker router, SDK, CLI,
// OpenAPI generator) consumes this table. There is no HTTP transport here;
// this is data plus pure lookup functions.
//
// The routes mirror Appendix C's event and type definitions and §13.1's
// system diagram:
//
//   GET  /health                      public
//   POST /v1/chat                     bearer
//   GET  /v1/chat/:id                 bearer
//   GET  /v1/chat/:id/stream          bearer   (SSE)
//   POST /v1/verify                   bearer
//   GET  /v1/memory                   bearer
//   POST /v1/memory                   bearer
//   DELETE /v1/memory/:id             bearer
//   GET  /v1/quota                    bearer
//   GET  /v1/receipt                  bearer
//   POST /v1/missions                 bearer
//   GET  /v1/missions/:id             bearer
//
// Zero external imports.

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export type AuthRequirement = 'public' | 'bearer';

export type RouteParamType = 'string' | 'number';

export interface RouteParam {
  name: string;
  type: RouteParamType;
}

export interface RestRoute {
  method: HttpMethod;
  /** Path template, e.g. "/v1/chat/:id" */
  path: string;
  auth: AuthRequirement;
  summary: string;
  /** Parameter names parsed from the path (in order). */
  params: RouteParam[];
  requestSchemaId: string | null;
  responseSchemaId: string;
  streaming: boolean;
}

export const ROUTES: readonly RestRoute[] = Object.freeze([
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/health',
    auth: 'public' as AuthRequirement,
    summary: 'Liveness probe. Always public. Returns { status: "ok" }',
    params: [],
    requestSchemaId: null,
    responseSchemaId: 'HealthResponse',
    streaming: false,
  }),
  Object.freeze({
    method: 'POST' as HttpMethod,
    path: '/v1/chat',
    auth: 'bearer' as AuthRequirement,
    summary: 'Send a turn. Returns a ChatTurn or an SSE stream when `stream: true`',
    params: [],
    requestSchemaId: 'ChatRequest',
    responseSchemaId: 'ChatTurn',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/chat/:id',
    auth: 'bearer' as AuthRequirement,
    summary: 'Fetch one ChatTurn by id',
    params: [{ name: 'id', type: 'string' as RouteParamType }],
    requestSchemaId: null,
    responseSchemaId: 'ChatTurn',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/chat/:id/stream',
    auth: 'bearer' as AuthRequirement,
    summary: 'SSE stream for an existing turn (reconnect path)',
    params: [{ name: 'id', type: 'string' as RouteParamType }],
    requestSchemaId: null,
    responseSchemaId: 'ChatStream',
    streaming: true,
  }),
  Object.freeze({
    method: 'POST' as HttpMethod,
    path: '/v1/verify',
    auth: 'bearer' as AuthRequirement,
    summary: 'Re-verify a claim against fresh retrieval',
    params: [],
    requestSchemaId: 'VerifyRequest',
    responseSchemaId: 'Claim',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/memory',
    auth: 'bearer' as AuthRequirement,
    summary: 'List memories (paginated, newest first)',
    params: [],
    requestSchemaId: null,
    responseSchemaId: 'MemoryList',
    streaming: false,
  }),
  Object.freeze({
    method: 'POST' as HttpMethod,
    path: '/v1/memory',
    auth: 'bearer' as AuthRequirement,
    summary: 'Create one memory. Subject to the curator pipeline',
    params: [],
    requestSchemaId: 'MemoryCreate',
    responseSchemaId: 'Memory',
    streaming: false,
  }),
  Object.freeze({
    method: 'DELETE' as HttpMethod,
    path: '/v1/memory/:id',
    auth: 'bearer' as AuthRequirement,
    summary: 'Forget one memory. Writes an audit row',
    params: [{ name: 'id', type: 'string' as RouteParamType }],
    requestSchemaId: null,
    responseSchemaId: 'ForgetAck',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/quota',
    auth: 'bearer' as AuthRequirement,
    summary: 'Current quota snapshot, one bar per pool',
    params: [],
    requestSchemaId: null,
    responseSchemaId: 'QuotaResponse',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/receipt',
    auth: 'bearer' as AuthRequirement,
    summary: 'Monthly £0.00 receipt',
    params: [],
    requestSchemaId: null,
    responseSchemaId: 'ReceiptResponse',
    streaming: false,
  }),
  Object.freeze({
    method: 'POST' as HttpMethod,
    path: '/v1/missions',
    auth: 'bearer' as AuthRequirement,
    summary: 'Create a mission from a Goal + TaskPlans',
    params: [],
    requestSchemaId: 'MissionCreate',
    responseSchemaId: 'Mission',
    streaming: false,
  }),
  Object.freeze({
    method: 'GET' as HttpMethod,
    path: '/v1/missions/:id',
    auth: 'bearer' as AuthRequirement,
    summary: 'Fetch the current state of one mission',
    params: [{ name: 'id', type: 'string' as RouteParamType }],
    requestSchemaId: null,
    responseSchemaId: 'Mission',
    streaming: false,
  }),
]);

export interface MatchedRoute {
  route: RestRoute;
  params: Record<string, string | number>;
}

function splitPath(path: string): string[] {
  if (path === '/') return [];
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (trimmed.length === 0) return [];
  return trimmed.split('/');
}

function matchSegments(
  template: string[],
  actual: string[],
): { params: Record<string, string | number> } | null {
  if (template.length !== actual.length) return null;
  const params: Record<string, string | number> = {};
  for (let i = 0; i < template.length; i++) {
    const t = template[i]!;
    const a = actual[i]!;
    if (t.startsWith(':')) {
      const name = t.slice(1);
      if (name.length === 0) return null;
      if (a.length === 0) return null;
      params[name] = a;
    } else if (t !== a) {
      return null;
    }
  }
  return { params };
}

export function matchRoute(
  method: HttpMethod,
  path: string,
): MatchedRoute | null {
  const actual = splitPath(path);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const template = splitPath(route.path);
    const m = matchSegments(template, actual);
    if (m !== null) {
      return { route, params: m.params };
    }
  }
  return null;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  security: Array<Record<string, string[]>>;
  parameters: Array<{ name: string; in: 'path'; required: true; schema: { type: string } }>;
  requestBody?: { required: true; content: { 'application/json': { schema: { $ref: string } } } };
  responses: Record<string, { description: string; content: Record<string, unknown> }>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

export function buildOpenApi(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const route of ROUTES) {
    const opId =
      route.method.toLowerCase() + '_' + route.path.replace(/[/:]/g, '_').replace(/^_+/, '').replace(/_+$/, '');
    const operation: OpenApiOperation = {
      operationId: opId.length > 0 ? opId : route.method.toLowerCase(),
      summary: route.summary,
      security:
        route.auth === 'bearer'
          ? [{ bearerAuth: [] }]
          : [],
      parameters: route.params.map((p) => ({
        name: p.name,
        in: 'path' as const,
        required: true as const,
        schema: { type: p.type },
      })),
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/' + route.responseSchemaId },
            },
          },
        },
      },
    };
    if (route.requestSchemaId !== null) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/' + route.requestSchemaId },
          },
        },
      };
    }
    const bucket = paths[route.path] ?? {};
    bucket[route.method.toLowerCase()] = operation;
    paths[route.path] = bucket;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Aura-lie API', version: '1.0.0' },
    paths,
  };
}
// === FILE END ===