// packages/router-engine/test/router-engine.test.ts
import { describe, it, expect } from 'vitest';
import { BreakerRegistry, runWaterfall } from '@aura-lie/circuit-breaker';
import {
  extractFeatures,
  route,
  StaticModelRegistry,
  createDefaultRegistry,
  __resetDefaultRegistry,
  requiredCapabilities,
  latencyFitFor,
} from '../src/index.js';
import type {
  ModelInfo,
  ModelRole,
  RoutingResult,
} from '../src/index.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function customRegistry(models: ModelInfo[]): StaticModelRegistry {
  return new StaticModelRegistry(models);
}

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    family: 'groq',
    model: 'test-model',
    lane: 'private',
    contextWindow: 128_000,
    tokensPerMinute: 8_000,
    capabilities: { reasoning: false, vision: false, json: true, tools: true },
    latencyClass: 'balanced',
    capability: { chat_fast: 0.8 },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
describe('Router Engine (PRD 7.3, 7.4, 7.5, FR-ROUTE-01..06, FR-TRUTH-05)', () => {
  // ---- Intent classification ----------------------------------------
  it('classifies meta questions', () => {
    expect(extractFeatures('what can you do?').intent).toBe('meta');
  });

  it('classifies research intent', () => {
    expect(extractFeatures('research the current state of perovskite solar cells').intent).toBe(
      'research',
    );
  });

  it('classifies code intent', () => {
    expect(extractFeatures('debug this function please').intent).toBe('code');
  });

  it('classifies compute intent for arithmetic', () => {
    expect(extractFeatures('calculate 42 * 17').intent).toBe('compute');
    expect(extractFeatures('what is 2+2').intent).toBe('compute');
  });

  it('classifies plan intent', () => {
    expect(extractFeatures('plan a three-day trip to Kyoto').intent).toBe('plan');
  });

  it('classifies memory intent', () => {
    expect(extractFeatures('remember that I prefer tea').intent).toBe('memory');
  });

  it('classifies action intent', () => {
    expect(extractFeatures('remind me at 3pm').intent).toBe('action');
  });

  it('defaults to chat for trivial greetings', () => {
    expect(extractFeatures('hi there').intent).toBe('chat');
  });

  // ---- Loop selection (PRD 7.5, FR-ROUTE-03) ------------------------
  it('FR-ROUTE-03: weather questions use the light loop', () => {
    const f = extractFeatures('what is the weather in Delhi today');
    expect(f.loop).toBe('light');
  });

  it('FR-ROUTE-03: trivial arithmetic uses the light loop', () => {
    const f = extractFeatures('what is 2+2');
    expect(f.loop).toBe('light');
  });

  it('chat uses the light loop', () => {
    expect(extractFeatures('hi there').loop).toBe('light');
  });

  it('research uses the deep loop', () => {
    expect(extractFeatures('research the latest in solar tech').loop).toBe('deep');
  });

  it('risk tier 2 uses the deep loop', () => {
    expect(extractFeatures('what happened in the news today').loop).toBe('deep');
  });

  it('code without freshness uses the standard loop', () => {
    expect(extractFeatures('debug this function please').loop).toBe('standard');
  });

  // ---- Language detection -------------------------------------------
  it('detects English', () => {
    expect(extractFeatures('What is the capital of France?').language).toBe('en');
  });

  it('detects Hindi from Devanagari script', () => {
    expect(extractFeatures('नमस्ते, कैसे हैं आप?').language).toBe('hi');
  });

  it('detects Hinglish from romanized markers', () => {
    expect(extractFeatures('yaar kya haal hai aaj').language).toBe('hinglish');
  });

  // ---- Risk tier ----------------------------------------------------
  it('medical questions are tier 3 + S2', () => {
    const f = extractFeatures('I have a persistent headache, what treatment should I try');
    expect(f.riskTier).toBe(3);
    expect(f.sensitivityHint).toBe('S2');
  });

  it('finance questions are tier 3 + S2', () => {
    const f = extractFeatures('should I invest my savings in stocks now?');
    expect(f.riskTier).toBe(3);
    expect(f.sensitivityHint).toBe('S2');
  });

  it('freshness-tagged questions are tier 2', () => {
    expect(extractFeatures('what is the latest news on X').riskTier).toBe(2);
  });

  it('general questions are tier 1', () => {
    expect(extractFeatures('what is the capital of France').riskTier).toBe(1);
  });

  it('trivial chit-chat is tier 0', () => {
    expect(extractFeatures('hi').riskTier).toBe(0);
  });

  // ---- Sensitivity --------------------------------------------------
  it('S2 for relationships', () => {
    expect(extractFeatures('my girlfriend and I are thinking about marriage').sensitivityHint).toBe(
      'S2',
    );
  });

  it('S2 for credentials', () => {
    expect(extractFeatures('I forgot my password again').sensitivityHint).toBe('S2');
  });

  it('S1 for personal-but-ordinary mentions', () => {
    expect(extractFeatures('my project uses PostgreSQL').sensitivityHint).toBe('S1');
  });

  it('S0 for general questions', () => {
    expect(extractFeatures('what is the capital of France').sensitivityHint).toBe('S0');
  });

  // ---- Registry (FR-ROUTE-04) ---------------------------------------
  it('default registry excludes paid models', () => {
    __resetDefaultRegistry();
    const reg = createDefaultRegistry();
    const list = reg.list();
    expect(list.some((m) => m.paid)).toBe(false);
    expect(list.some((m) => m.model === 'gpt-4-turbo')).toBe(false);
  });

  it('byRole returns only models with that role capability', () => {
    __resetDefaultRegistry();
    const reg = createDefaultRegistry();
    const judges = reg.byRole('judge');
    expect(judges.length).toBeGreaterThan(0);
    expect(judges.every((m) => (m.capability.judge ?? 0) > 0)).toBe(true);
  });

  it('createDefaultRegistry returns a stable singleton', () => {
    __resetDefaultRegistry();
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    expect(a).toBe(b);
  });

  // ---- Role → capability derivation ---------------------------------
  it('judge requires json capability', () => {
    const caps = requiredCapabilities('judge', extractFeatures('hello'));
    expect(caps).toContain('json');
  });

  it('reasoner requires reasoning capability', () => {
    const caps = requiredCapabilities('reasoner', extractFeatures('hello'));
    expect(caps).toContain('reasoning');
  });

  it('vision requires vision capability', () => {
    const caps = requiredCapabilities('vision', extractFeatures('hello'));
    expect(caps).toContain('vision');
  });

  it('tool-using prompt requires tools capability', () => {
    const f = extractFeatures('search the web for the weather in Delhi');
    const caps = requiredCapabilities('chat_fast', f);
    expect(caps).toContain('tools');
  });

  // ---- Latency fit --------------------------------------------------
  it('latencyFitFor prefers fast models for chat_fast', () => {
    expect(latencyFitFor('chat_fast', 'fast')).toBe(1.0);
    expect(latencyFitFor('chat_fast', 'strong')).toBeLessThan(1.0);
  });

  it('latencyFitFor prefers strong models for reasoner', () => {
    expect(latencyFitFor('reasoner', 'strong')).toBe(1.0);
    expect(latencyFitFor('reasoner', 'fast')).toBeLessThan(1.0);
  });

  // ---- Route: role mapping ------------------------------------------
  it('route returns chat_fast candidates', () => {
    __resetDefaultRegistry();
    const result = route('hello there', 'chat_fast');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.role === 'chat_fast')).toBe(true);
  });

  it('route returns vision candidates only when vision required', () => {
    __resetDefaultRegistry();
    const result = route('describe this image', 'vision');
    expect(result.candidates.every((c) => {
      const models = createDefaultRegistry().list();
      const m = models.find((x) => x.family === c.family && x.model === c.model);
      return !!m?.capabilities.vision;
    })).toBe(true);
  });

  // ---- Hard filter: sensitivity -------------------------------------
  it('S2 claims only route to the private lane', () => {
    const reg = customRegistry([
      model({
        family: 'gemini',
        model: 'gemini-flash',
        lane: 'training-risk',
        capability: { chat_fast: 0.95 }, // higher capability, but training-risk
      }),
      model({
        family: 'groq',
        model: 'llama-70b',
        lane: 'private',
        capability: { chat_fast: 0.6 },
      }),
    ]);
    const result = route('I have a headache, what treatment should I take', 'chat_fast', {
      registry: reg,
    });
    expect(result.candidates.every((c) => c.family !== 'gemini')).toBe(true);
    expect(result.candidates.some((c) => c.family === 'groq')).toBe(true);
  });

  it('S1 claims route to the private lane by default', () => {
    const reg = customRegistry([
      model({ family: 'gemini', lane: 'training-risk', capability: { chat_fast: 0.9 } }),
      model({ family: 'groq', lane: 'private', capability: { chat_fast: 0.5 } }),
    ]);
    const result = route('my project uses PostgreSQL', 'chat_fast', { registry: reg });
    expect(result.candidates.every((c) => c.family !== 'gemini')).toBe(true);
  });

  it('S1 claims can route to training-risk if allowTrainingRiskForS1 is set', () => {
    const reg = customRegistry([
      model({ family: 'gemini', lane: 'training-risk', capability: { chat_fast: 0.9 } }),
      model({ family: 'groq', lane: 'private', capability: { chat_fast: 0.5 } }),
    ]);
    const result = route('my project uses PostgreSQL', 'chat_fast', {
      registry: reg,
      allowTrainingRiskForS1: true,
    });
    // Gemini is now allowed; higher capability places it first.
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0].family).toBe('gemini');
  });

  // ---- Hard filter: context window -----------------------------------
  it('rejects candidate whose context window is too small', () => {
    const reg = customRegistry([
      model({ family: 'cerebras', contextWindow: 500, tokensPerMinute: 60_000 }),
    ]);
    const result = route('x', 'chat_fast', {
      registry: reg,
      promptTokensEstimate: 1_000,
    });
    expect(result.candidates.length).toBe(0);
    expect(result.scored[0].rejected?.filter).toBe('context-window');
  });

  // ---- Hard filter: TPM 60% rule (PRD 7.4) --------------------------
  it('rejects candidate when prompt exceeds 60% of TPM', () => {
    const reg = customRegistry([
      model({ family: 'groq', contextWindow: 128_000, tokensPerMinute: 1_000 }),
    ]);
    const result = route('x', 'chat_fast', {
      registry: reg,
      promptTokensEstimate: 700, // 70% of 1000 TPM > 60%
    });
    expect(result.candidates.length).toBe(0);
    expect(result.scored[0].rejected?.filter).toBe('tpm-headroom');
  });

  it('accepts candidate at exactly 60% of TPM', () => {
    const reg = customRegistry([
      model({ family: 'groq', contextWindow: 128_000, tokensPerMinute: 1_000 }),
    ]);
    const result = route('x', 'chat_fast', {
      registry: reg,
      promptTokensEstimate: 600,
    });
    expect(result.candidates.length).toBe(1);
  });

  // ---- Hard filter: breaker -----------------------------------------
  it('rejects candidates whose breaker is open', () => {
    const reg = customRegistry([
      model({ family: 'groq', capability: { chat_fast: 0.9 } }),
      model({ family: 'gemini', lane: 'training-risk', capability: { chat_fast: 0.8 } }),
    ]);
    const breakers = new BreakerRegistry();
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    expect(breakers.getState('groq')).toBe('open');

    const result = route('hello', 'chat_fast', { registry: reg, breakers });
    expect(result.candidates.some((c) => c.family === 'groq')).toBe(false);
    expect(result.candidates.some((c) => c.family === 'gemini')).toBe(true);
  });

  // ---- Hard filter: quota headroom ---------------------------------
  it('rejects candidates when headroom returns 0', () => {
    const reg = customRegistry([
      model({ family: 'groq', capability: { chat_fast: 0.9 } }),
      model({ family: 'cerebras', capability: { chat_fast: 0.7 } }),
    ]);
    const headroom = (family: string) => (family === 'groq' ? 0 : 1);
    const result = route('hello', 'chat_fast', { registry: reg, headroom });
    expect(result.candidates.some((c) => c.family === 'groq')).toBe(false);
    expect(result.candidates.some((c) => c.family === 'cerebras')).toBe(true);
  });

  // ---- Hard filter: capability --------------------------------------
  it('rejects models that lack the required capability', () => {
    const reg = customRegistry([
      model({
        family: 'cerebras',
        capabilities: { reasoning: false, vision: false, json: true, tools: false },
        capability: { reasoner: 0.9 },
      }),
    ]);
    const result = route('think about this', 'reasoner', { registry: reg });
    expect(result.candidates.length).toBe(0);
    expect(result.scored[0].rejected?.filter).toBe('capability');
  });

  // ---- Soft score ---------------------------------------------------
  it('soft score prefers higher capability when other factors are equal', () => {
    const reg = customRegistry([
      model({ family: 'groq', capability: { chat_fast: 0.9 } }),
      model({ family: 'cerebras', capability: { chat_fast: 0.5 } }),
    ]);
    const result = route('hello', 'chat_fast', { registry: reg });
    expect(result.candidates[0].family).toBe('groq');
    expect(result.candidates[1].family).toBe('cerebras');
  });

  it('soft score prefers more headroom at equal capability', () => {
    const reg = customRegistry([
      model({ family: 'groq', capability: { chat_fast: 0.8 } }),
      model({ family: 'cerebras', capability: { chat_fast: 0.8 } }),
    ]);
    const headroom = (family: string) => (family === 'groq' ? 0.2 : 0.9);
    const result = route('hello', 'chat_fast', { registry: reg, headroom });
    expect(result.candidates[0].family).toBe('cerebras');
  });

  it('FR-TRUTH-05: judge role prefers a different family via diversity bonus', () => {
    const reg = customRegistry([
      model({
        family: 'groq',
        capability: { judge: 0.7 },
        capabilities: { reasoning: false, vision: false, json: true, tools: false },
      }),
      model({
        family: 'gemini',
        lane: 'training-risk',
        capability: { judge: 0.7 },
        capabilities: { reasoning: false, vision: false, json: true, tools: false },
      }),
      model({
        family: 'cerebras',
        capability: { judge: 0.7 },
        capabilities: { reasoning: false, vision: false, json: true, tools: false },
      }),
    ]);
    const result = route('judge this', 'judge', {
      registry: reg,
      generatorFamily: 'groq',
    });
    // Gemini and cerebras should rank above groq because of the 1.5× diversity bonus.
    expect(result.candidates[0].family).not.toBe('groq');
    expect(result.candidates[result.candidates.length - 1].family).toBe('groq');
  });

  // ---- Integration with circuit-breaker waterfall ------------------
  it('route output feeds runWaterfall without adaptation', async () => {
    __resetDefaultRegistry();
    const routing = route('hello there', 'chat_fast');
    let called = 0;
    const result = await runWaterfall(routing.candidates, async () => {
      called += 1;
      return 'answer';
    });
    expect(result.ok).toBe(true);
    expect(called).toBe(1);
  });

  it('T-14 via router: fault on first candidate, answer arrives via second', async () => {
    __resetDefaultRegistry();
    const routing = route('hello there', 'chat_fast');
    const first = routing.candidates[0];
    const result = await runWaterfall(routing.candidates, async (c) => {
      if (c.family === first.family) throw new Error('ECONNREFUSED');
      return `answer-from-${c.family}`;
    });
    expect(result.ok).toBe(true);
    expect(result.winner?.family).not.toBe(first.family);
    expect(result.attempts[0].outcome).toBe('failure');
    expect(result.attempts[1].outcome).toBe('success');
  });

  it('returns empty candidates when nothing survives the hard filters', () => {
    const reg = customRegistry([
      model({
        family: 'gemini',
        lane: 'training-risk',
        capability: { chat_fast: 0.9 },
      }),
    ]);
    const result = route('I have a medical condition, should I take this medicine', 'chat_fast', {
      registry: reg,
    });
    expect(result.candidates.length).toBe(0);
    expect(result.scored[0].rejected?.filter).toBe('sensitivity-lane');
  });

  // ---- Features on RoutingResult -----------------------------------
  it('RoutingResult.features carries the extracted classification', () => {
    __resetDefaultRegistry();
    const result: RoutingResult = route('what is the weather in Delhi today', 'chat_fast');
    expect(result.features.intent).toBe('question');
    expect(result.features.loop).toBe('light');
    expect(result.features.tools).toContain('weather');
  });

  it('RoutingResult.promptTokens is the estimate used for filtering', () => {
    __resetDefaultRegistry();
    const result = route('hello', 'chat_fast', { promptTokensEstimate: 42 });
    expect(result.promptTokens).toBe(42);
  });
});