import { Router, QuotaLedger, CircuitBreaker } from '@aura-lie/router';
import type { RouterRequest, ModelAdapter } from '@aura-lie/router';
import type { ChatEvent, ChatRequest } from '@aura-lie/stream';
import { Planner } from '@aura-lie/orchestrator';

export class AuraLieLoop {
  private router: Router;
  private ledger: QuotaLedger;
  private breaker: CircuitBreaker;
  private planner = new Planner();

  constructor(env: any = {}) {
    const pools = { 'groq': { used: 0, limit: 1000 }, 'gemini': { used: 0, limit: 500 } };
    this.ledger = new QuotaLedger(pools);
    this.breaker = new CircuitBreaker();

    // Default mock model to training-risk to trigger RouterError on S2
    const models: ModelAdapter[] = env.MODELS || [
      { id: 'mock-1', provider: 'mock', lane: 'training-risk', roles: ['chat_fast', 'reasoner'], contextWindow: 8192, health: 1.0, costPer1kTokens: 0 }
    ];
    this.router = new Router(models);
  }

  public processMessage(req: any): AsyncGenerator<ChatEvent> {
    return this.execute({
      message: req.query || req.message,
      mode: req.mode,
      persona: req.persona || 'Aura-lie',
      thinking: req.thinking ?? true
    });
  }

  public async *execute(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const startTime = Date.now();
    const turnId = Math.random().toString(36).substring(7);
    
    try {
      const plan = this.planner.plan(req.message, req.mode as any);
      
      yield {
        t: 'meta',
        v: 1,
        turnId,
        mode: req.mode as any,
        persona: req.persona,
        route: { role: plan.loop === 'deep' ? 'reasoner' : 'chat_fast', family: 'mock-family' },
        sensitivity: plan.sensitivity,
        riskTier: plan.riskTier,
      };

      yield { t: 'trace', seq: 1, tMs: Date.now() - startTime, type: 'plan', text: `Selected ${plan.loop} loop` };
      
      const routerReq: RouterRequest = {
        role: plan.loop === 'deep' ? 'reasoner' : 'chat_fast',
        sensitivity: plan.sensitivity,
        promptLength: req.message.length
      };
      
      const selection = this.router.select(routerReq);
      
      const mockTokens = ["This is ", "a mock ", "response."];
      for (const token of mockTokens) {
        yield { t: 'token', delta: token };
        await new Promise(r => setTimeout(r, 5)); 
      }

      yield { t: 'summary', overall: null, checked: 0, checkable: 0, chip: 'RECALL-ONLY', heuristic: true };
      yield { t: 'done', elapsedMs: Date.now() - startTime, calls: 1, tokens: 34, costInr: 0 };

    } catch (err: any) {
      yield { t: 'error', code: 'ROUTER_FAILED', userMessage: `Routing failed: ${err.message}` };
    }
  }
}