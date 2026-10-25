// === FILE START ===
// packages/agents/src/sdk-js-v2.ts
// PRD §14.6 · FR-DEV-05 · T-13.
//
// The JavaScript SDK. A typed client over the REST contract declared in
// rest-api-v2.ts. The SDK does not talk to the network itself — it accepts a
// `Transport` interface that callers plug in (real fetch in the browser, a
// mock in tests, a CLI adapter that prints JSON). This keeps the SDK pure and
// testable and lets the CLI reuse the same method table.
//
// Every method:
//   · validates its arguments locally (fast failure, no wasted quota)
//   · calls `matchRoute` to confirm the route exists in the manifest
//   · delegates to `transport.request(method, path, body)`
//
// Only relative imports (from the sibling rest-api-v2 module).

import type { HttpMethod } from './rest-api-v2.js';
import { matchRoute } from './rest-api-v2.js';

export interface TransportRequest {
  method: HttpMethod;
  path: string;
  bearerToken: string | null;
  body: unknown;
}

export interface TransportResponse<T> {
  status: number;
  body: T;
}

export interface Transport {
  request<T>(req: TransportRequest): Promise<TransportResponse<T>>;
}

export interface AuraClientConfig {
  bearerToken: string;
  transport: Transport;
}

// Minimal typed response shapes. A full deployment would generate these from
// the OpenAPI document; here they are hand-written and small.
export interface HealthResponse { status: 'ok' }
export interface ChatRequest { message: string; stream?: boolean; mode?: 'instant' | 'think' | 'research' | 'council' }
export interface ChatTurn { id: string; answer: string; claims: number; costInr: 0 }
export interface VerifyRequest { claimId: string }
export interface Claim { id: string; status: string; score: number | null }
export interface MemoryCreate { text: string; sensitivity: 'S0' | 'S1' | 'S2' }
export interface Memory { id: string; text: string; createdAt: number }
export interface MemoryList { items: Memory[]; nextCursor: string | null }
export interface ForgetAck { id: string; forgotten: true }
export interface QuotaPool { pool: string; used: number; limit: number }
export interface QuotaResponse { pools: QuotaPool[] }
export interface ReceiptResponse { month: string; replies: number; costInr: 0 }
export interface MissionCreate { goal: string; tasks: Array<{ id: string; plannedActions: Array<{ kind: string; target: string; irreversible?: boolean }> }> }
export interface Mission { id: string; cursor: number; totalSteps: number; stopped: string | null }

export class AuraClient {
  private readonly token: string;
  private readonly transport: Transport;

  constructor(config: AuraClientConfig) {
    if (typeof config.bearerToken !== 'string' || config.bearerToken.length === 0) {
      throw new Error('AuraClient: bearerToken must be a non-empty string');
    }
    this.token = config.bearerToken;
    this.transport = config.transport;
  }

  private assertRoute(method: HttpMethod, path: string): void {
    if (matchRoute(method, path) === null) {
      throw new Error(`AuraClient: no route for ${method} ${path}`);
    }
  }

  async health(): Promise<HealthResponse> {
    this.assertRoute('GET', '/health');
    const r = await this.transport.request<HealthResponse>({
      method: 'GET',
      path: '/health',
      bearerToken: null,
      body: null,
    });
    return r.body;
  }

  async chat(req: ChatRequest): Promise<ChatTurn> {
    if (typeof req.message !== 'string' || req.message.length === 0) {
      throw new Error('chat: message must be a non-empty string');
    }
    this.assertRoute('POST', '/v1/chat');
    const r = await this.transport.request<ChatTurn>({
      method: 'POST',
      path: '/v1/chat',
      bearerToken: this.token,
      body: req,
    });
    return r.body;
  }

  async getChat(id: string): Promise<ChatTurn> {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('getChat: id must be a non-empty string');
    }
    this.assertRoute('GET', `/v1/chat/${id}`);
    const r = await this.transport.request<ChatTurn>({
      method: 'GET',
      path: `/v1/chat/${id}`,
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }

  async verify(req: VerifyRequest): Promise<Claim> {
    if (typeof req.claimId !== 'string' || req.claimId.length === 0) {
      throw new Error('verify: claimId must be a non-empty string');
    }
    this.assertRoute('POST', '/v1/verify');
    const r = await this.transport.request<Claim>({
      method: 'POST',
      path: '/v1/verify',
      bearerToken: this.token,
      body: req,
    });
    return r.body;
  }

  async listMemory(): Promise<MemoryList> {
    this.assertRoute('GET', '/v1/memory');
    const r = await this.transport.request<MemoryList>({
      method: 'GET',
      path: '/v1/memory',
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }

  async createMemory(req: MemoryCreate): Promise<Memory> {
    if (typeof req.text !== 'string' || req.text.length === 0) {
      throw new Error('createMemory: text must be a non-empty string');
    }
    this.assertRoute('POST', '/v1/memory');
    const r = await this.transport.request<Memory>({
      method: 'POST',
      path: '/v1/memory',
      bearerToken: this.token,
      body: req,
    });
    return r.body;
  }

  async forgetMemory(id: string): Promise<ForgetAck> {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('forgetMemory: id must be a non-empty string');
    }
    this.assertRoute('DELETE', `/v1/memory/${id}`);
    const r = await this.transport.request<ForgetAck>({
      method: 'DELETE',
      path: `/v1/memory/${id}`,
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }

  async quota(): Promise<QuotaResponse> {
    this.assertRoute('GET', '/v1/quota');
    const r = await this.transport.request<QuotaResponse>({
      method: 'GET',
      path: '/v1/quota',
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }

  async receipt(): Promise<ReceiptResponse> {
    this.assertRoute('GET', '/v1/receipt');
    const r = await this.transport.request<ReceiptResponse>({
      method: 'GET',
      path: '/v1/receipt',
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }

  async createMission(req: MissionCreate): Promise<Mission> {
    if (typeof req.goal !== 'string' || req.goal.length === 0) {
      throw new Error('createMission: goal must be a non-empty string');
    }
    this.assertRoute('POST', '/v1/missions');
    const r = await this.transport.request<Mission>({
      method: 'POST',
      path: '/v1/missions',
      bearerToken: this.token,
      body: req,
    });
    return r.body;
  }

  async getMission(id: string): Promise<Mission> {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('getMission: id must be a non-empty string');
    }
    this.assertRoute('GET', `/v1/missions/${id}`);
    const r = await this.transport.request<Mission>({
      method: 'GET',
      path: `/v1/missions/${id}`,
      bearerToken: this.token,
      body: null,
    });
    return r.body;
  }
}
// === FILE END ===