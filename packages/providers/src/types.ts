export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
}

export interface ChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  stream?: boolean;
}

export interface ChatEvent {
  type: 'token' | 'reasoning' | 'usage' | 'finish';
  text?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LimitSnapshot {
  provider: string;
  model: string;
  rpmLeft?: number;
  rpdLeft?: number;
  resetsAt?: string;
  source: 'headers' | '429' | 'estimate';
}

export interface ProviderAdapter {
  id: string; // "groq", "gemini", "cloudflare"
  lane: 'private' | 'training-risk';
  listModels(): Promise<ModelInfo[]>;
  roles(): Record<string, string | null>;
  limits(): LimitSnapshot;
  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
  health(): 'ok' | 'degraded' | 'down';
}