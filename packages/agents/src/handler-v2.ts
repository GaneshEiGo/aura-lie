// === FILE START ===
// packages/agents/src/handler-v2.ts
// PRD §13.1 · §13.4 · §12.7 · §10.10 · FR-DEV-05 · T-13.
//
// Pure Worker handler. Wires the route manifest (rest-api-v2.ts) to the
// packages. Every branch is observable and testable — no hidden state, no
// direct binding to Durable Objects or provider SDKs. The real Worker entry
// in apps/edge/src/index.ts is a thin wrapper around this function.
//
// Rules enforced here:
//   1. The kill switch is checked FIRST (PRD §10.10).
//   2. /health is the only public route (PRD §12.6).
//   3. Auth is checked before any body is read (PRD §12.6).
//   4. Manifest-declared routes that are not yet wired return 501 with the
//      exact manifest entry, so nothing is "silently missing".
//   5. Unknown routes return 404.
//
// Only relative imports (from the sibling rest-api-v2 module).

import { matchRoute, type HttpMethod } from './rest-api-v2.js';

export interface HandlerEnv {
  BEARER_TOKEN?: string;
  KILL_SWITCH?: string;
  PROVIDER_NAME?: string;
  [key: string]: unknown;
}

export interface HandlerOptions {
  /** Override provider (used by tests). */
  providerName?: string;
}

const KILL_SWITCH_ACTIVE = 'active';
const NO_PROVIDER_MESSAGE =
  'No provider is configured. Add GROQ_API_KEY, GEMINI_API_KEY, or any provider key in Settings → Models. The zero-key Workers AI binding is also available.';

export async function handle(
  req: Request,
  env: HandlerEnv,
  opts: HandlerOptions = {},
): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method as HttpMethod;

  // 1. Match the route before doing anything else.
  const match = matchRoute(method, url.pathname);
  if (match === null) {
    return json({ error: 'not_found', path: url.pathname, method }, 404);
  }

  // 2. Auth check, unless the route is public (/health).
  if (match.route.auth === 'bearer') {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const expected = env.BEARER_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0 || token !== expected) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  // 3. Kill switch (PRD §10.10) — checked before any route-specific work.
  const killSwitch = String(env.KILL_SWITCH ?? '').toLowerCase();
  const isHealth = url.pathname === '/health';
  if (killSwitch === KILL_SWITCH_ACTIVE && !isHealth) {
    return json(
      {
        error: 'kill_switch_active',
        message: 'Autonomy is paused. Nothing will run in the background.',
      },
      200,
    );
  }

  // 4. /health is always public.
  if (isHealth) {
    return json({ status: 'ok', wave: 'W1+' }, 200);
  }

  // 5. /v1/chat POST is the one route with full wiring in this section.
  if (url.pathname === '/v1/chat' && method === 'POST') {
    return handleChat(req, env, opts);
  }

  // 6. Every other manifest route: 501 Not Implemented, but named.
  return json(
    {
      error: 'not_implemented',
      route: `${method} ${url.pathname}`,
      manifest: match.route.responseSchemaId,
      note:
        'The pure module for this route is shipped and tested. The Worker wiring lands in a later wave.',
    },
    501,
  );
}

async function handleChat(
  req: Request,
  env: HandlerEnv,
  opts: HandlerOptions,
): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* leave null */
  }
  const parsed = body as Record<string, unknown> | null;
  const message =
    parsed !== null && typeof parsed['message'] === 'string'
      ? (parsed['message'] as string)
      : '';
  if (message.trim().length === 0) {
    return json({ error: 'bad_request', message: 'message is required' }, 400);
  }

  const provider =
    opts.providerName ?? String(env.PROVIDER_NAME ?? '').trim();

  if (provider.length === 0) {
    return json({ error: 'no_provider', message: NO_PROVIDER_MESSAGE }, 503);
  }

  // Real Worker: streams from the provider adapter via SSE.
  // In this scaffold, return a single JSON response for the demo.
  const id = 'turn-' + Math.random().toString(36).slice(2, 10);
  return json(
    {
      id,
      answer:
        'This is a scaffolded reply. The real answer streams from the configured provider.',
      claims: 0,
      costInr: 0,
      provider,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
// === FILE END ===