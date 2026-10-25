// apps/edge/src/app.ts
// The fully assembled Worker handler. Wraps:
//   - GET /health              (W1 — public)
//   - POST /v1/chat            (Sections 58/59 — SSE)
//   - POST /v1/pause           (Section 61 — kill switch)
//   - POST /v1/resume          (Section 61)
//   - GET  /v1/quota           (Section 55 — snapshot)
//   - POST /v1/tools/:id       (Sections 62/63 — sandboxed execution)

import { handleChatRequest } from '@aura-lie/edge-chat-handler';
import type { ChatHandlerDeps } from '@aura-lie/edge-chat-handler';
import {
  runTool,
  type ExecutorMap,
} from '@aura-lie/tools-runner';
import {
  SessionContext,
  type ToolRegistry,
} from '@aura-lie/permission-tools';
import type { KillSwitch } from '@aura-lie/kill-switch-audit';
import type { QuotaLedger } from '@aura-lie/quota-ledger';

export interface EdgeAppDeps extends ChatHandlerDeps {
  killSwitch?: KillSwitch;
  quotaLedger?: QuotaLedger;
  toolRegistry?: ToolRegistry;
  toolExecutors?: ExecutorMap;
}

export type EdgeApp = (req: Request) => Promise<Response>;

export function createEdgeApp(deps: EdgeAppDeps): EdgeApp {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method;

    // ---- Health (public) ------------------------------------------
    if (url.pathname === '/health' && method === 'GET') {
      return jsonResponse({ status: 'ok', version: '0.1.0' }, 200);
    }

    // ---- Chat (SSE) -----------------------------------------------
    if (url.pathname === '/v1/chat' && method === 'POST') {
      return handleChatRequest(req, deps);
    }

    // ---- Pause / resume (kill switch) -----------------------------
    if (url.pathname === '/v1/pause' && method === 'POST') {
      if (!deps.killSwitch) {
        return jsonResponse({ error: 'kill_switch_not_configured' }, 501);
      }
      const auth = await deps.authenticate(req);
      if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
      const body = await safeJson(req);
      await deps.killSwitch.pause(
        body?.actor ?? auth.userId,
        body?.reason ?? 'manual',
      );
      return jsonResponse({ paused: true, snapshot: deps.killSwitch.snapshot() }, 200);
    }

    if (url.pathname === '/v1/resume' && method === 'POST') {
      if (!deps.killSwitch) {
        return jsonResponse({ error: 'kill_switch_not_configured' }, 501);
      }
      const auth = await deps.authenticate(req);
      if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
      const body = await safeJson(req);
      await deps.killSwitch.resume(
        body?.actor ?? auth.userId,
        body?.reason ?? 'manual',
      );
      return jsonResponse({ paused: false, snapshot: deps.killSwitch.snapshot() }, 200);
    }

    // ---- Quota snapshot -------------------------------------------
    if (url.pathname === '/v1/quota' && method === 'GET') {
      const auth = await deps.authenticate(req);
      if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
      if (!deps.quotaLedger) return jsonResponse({ pools: [] }, 200);
      return jsonResponse({ pools: deps.quotaLedger.snapshotAll() }, 200);
    }

    // ---- Tool execution -------------------------------------------
    if (url.pathname.startsWith('/v1/tools/') && method === 'POST') {
      if (!deps.toolRegistry || !deps.toolExecutors) {
        return jsonResponse({ error: 'tools_not_configured' }, 501);
      }
      const auth = await deps.authenticate(req);
      if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

      const toolId = url.pathname.slice('/v1/tools/'.length);
      const body = await safeJson(req);
      const result = await runTool(
        deps.toolRegistry,
        toolId,
        body?.input ?? body,
        {
          turnId: `tool-${Date.now()}`,
          actor: auth.userId,
          permission: {
            level: body?.level ?? 2,
            sensitivity: body?.sensitivity ?? 'S0',
            tainted: body?.tainted === true,
            session: new SessionContext(),
          },
        },
        deps.toolExecutors,
      );
      return jsonResponse(result, 200);
    }

    return jsonResponse({ error: 'not_found' }, 404);
  };
}

async function safeJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}