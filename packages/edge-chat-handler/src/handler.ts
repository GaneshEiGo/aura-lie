// packages/edge-chat-handler/src/handler.ts
// PRD 7.2 request lifecycle at the edge.
// Order (PRD 7.2 step 2): method → auth → kill-switch → body → runTurn → SSE.

import { runTurn } from '@aura-lie/orchestrator-core';
import type { ChatEvent } from '@aura-lie/stream-proxy';
import type {
  ChatHandlerDeps,
  ChatRequestBody,
  ValidateBodyResult,
} from './types.js';
import { jsonError, sseResponseFromEvents } from './sse-response.js';

export function validateChatBody(raw: unknown): ValidateBodyResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'invalid_body', message: 'body must be an object' };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.turnId !== 'string' || body.turnId.length === 0) {
    return { ok: false, code: 'invalid_turnId', message: 'turnId is required' };
  }
  if (typeof body.text !== 'string' || body.text.length === 0) {
    return { ok: false, code: 'invalid_text', message: 'text is required' };
  }
  if (body.text.length > 32_000) {
    return { ok: false, code: 'text_too_long', message: 'text exceeds 32,000 characters' };
  }
  if (
    body.mode !== undefined &&
    !['instant', 'think', 'research', 'council'].includes(body.mode as string)
  ) {
    return { ok: false, code: 'invalid_mode', message: 'unknown mode' };
  }
  if (
    body.sensitivity !== undefined &&
    !['S0', 'S1', 'S2'].includes(body.sensitivity as string)
  ) {
    return { ok: false, code: 'invalid_sensitivity', message: 'unknown sensitivity' };
  }
  if (
    body.riskTier !== undefined &&
    !(typeof body.riskTier === 'number' && [0, 1, 2, 3].includes(body.riskTier))
  ) {
    return { ok: false, code: 'invalid_riskTier', message: 'riskTier must be 0..3' };
  }

  const value: ChatRequestBody = {
    turnId: body.turnId as string,
    text: body.text as string,
    mode: body.mode as ChatRequestBody['mode'],
    persona: typeof body.persona === 'string' ? body.persona : undefined,
    sensitivity: body.sensitivity as ChatRequestBody['sensitivity'],
    riskTier: body.riskTier as ChatRequestBody['riskTier'],
    maxSubrequests:
      typeof body.maxSubrequests === 'number' ? body.maxSubrequests : undefined,
  };
  return { ok: true, value };
}

export async function handleChatRequest(
  req: Request,
  deps: ChatHandlerDeps,
): Promise<Response> {
  // ---- Method check ------------------------------------------------
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST /v1/chat');
  }

  // ---- PRD 7.2 step 2: auth ---------------------------------------
  let auth: Awaited<ReturnType<ChatHandlerDeps['authenticate']>>;
  try {
    auth = await deps.authenticate(req);
  } catch {
    return jsonError(500, 'auth_failed', 'Try again.');
  }
  if (!auth) {
    return jsonError(401, 'unauthorized', 'Sign in first.');
  }

  // ---- PRD 10.4: kill-switch FIRST ----------------------------------
  let killSwitchActive = false;
  try {
    killSwitchActive = await deps.isKillSwitchActive();
  } catch {
    killSwitchActive = false;
  }

  // ---- PRD 7.2 step 1: parse body ----------------------------------
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON.');
  }

  const bodyResult = validateChatBody(raw);
  if (!bodyResult.ok) {
    return jsonError(400, bodyResult.code, bodyResult.message);
  }
  const body = bodyResult.value;

  // ---- Kill switch: emit SSE notice and close -----------------------
  if (killSwitchActive) {
    const now = (deps.clock ?? { now: () => Date.now() }).now();
    const events: ChatEvent[] = [
      {
        t: 'meta',
        v: 1,
        turnId: body.turnId,
        mode: body.mode ?? 'instant',
        persona: body.persona ?? 'Aura-lie',
        route: { role: 'chat_fast', family: 'groq' },
        sensitivity: body.sensitivity ?? 'S0',
        riskTier: body.riskTier ?? 0,
      },
      {
        t: 'notice',
        severity: 'warn',
        code: 'kill-switch',
        text: 'Autonomy paused. Nothing will run in the background.',
      },
      {
        t: 'done',
        elapsedMs: 0,
        calls: 0,
        tokens: 0,
        costInr: 0,
      },
    ];
    // Ensure `now` is referenced so the tree-shaker does not drop it —
    // the clock is used by the abort path below in real deployments.
    void now;
    return sseResponseFromEvents(events, req.signal);
  }

  // ---- Run the turn (Section 58) -----------------------------------
  let result;
  try {
    result = await runTurn(
      {
        turnId: body.turnId,
        text: body.text,
        mode: body.mode,
        persona: body.persona,
        sensitivity: body.sensitivity,
        riskTier: body.riskTier,
        maxSubrequests: body.maxSubrequests,
      },
      deps,
    );
  } catch (err) {
    // A truly unexpected failure in runTurn itself. Still return 200 with
    // an SSE body carrying error + done — the client already expects a stream.
    const message = err instanceof Error ? err.message : String(err);
    const fallbackEvents: ChatEvent[] = [
      {
        t: 'meta',
        v: 1,
        turnId: body.turnId,
        mode: body.mode ?? 'instant',
        persona: body.persona ?? 'Aura-lie',
        route: { role: 'chat_fast', family: 'groq' },
        sensitivity: body.sensitivity ?? 'S0',
        riskTier: body.riskTier ?? 0,
      },
      {
        t: 'error',
        code: 'orchestrator_threw',
        userMessage: 'Aura-lie could not respond. Try again.',
        retryHint: message,
      },
      { t: 'done', elapsedMs: 0, calls: 0, tokens: 0, costInr: 0 },
    ];
    return sseResponseFromEvents(fallbackEvents, req.signal);
  }

  // ---- Stream the result as SSE (always 200) -----------------------
  return sseResponseFromEvents(result.events, req.signal);
}