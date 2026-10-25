import { z } from 'zod';

// 1. The Thinking / Trace events (PRD §5.5)
export const TraceEventSchema = z.object({
  t: z.string(), // Time e.g., "0.0s", "2.4s"
  type: z.string(), // 'plan', 'memory', 'router', 'search', 'fetch', 'verify', 'critic', 'style', 'score'
  msg: z.string(), // The HTML string with classes (e.g., '<span class="tr-strong">model</span>')
});

// 2. The Claim Event (Powers the Fact Chips PRD §5.6)
export const ClaimEventSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.string(), // 'number', 'fact', 'date'
  importance: z.number(),
  score: z.number().nullable(),
  status: z.string(),
  band: z.string(),
  glyph: z.string(),
  factors: z.array(z.object({ label: z.string(), value: z.number() })),
  sources: z.array(z.object({
    tier: z.number(),
    domain: z.string(),
    title: z.string(),
    date: z.string(),
    quote: z.string().optional(),
  })),
  contradictions: z.array(z.object({
    other: z.string(),
    cause: z.string(),
  })),
  strengthen: z.string().optional(),
});

// 3. The Chat Event Union (Streamed via SSE to the UI)
export const ChatEventSchema = z.discriminatedUnion('t', [
  // Sent at the very start of the turn
  z.object({
    t: z.literal('meta'),
    turnId: z.string(),
    mode: z.string(),
    persona: z.string(),
    lane: z.string(),
    sensitivity: z.string(),
  }),
  // Streamed token by token for the main answer
  z.object({
    t: z.literal('token'),
    delta: z.string(),
  }),
  // Streamed if the model outputs reasoning (like DeepSeek R1)
  z.object({
    t: z.literal('thinking'),
    delta: z.string(),
    kind: z.enum(['summary', 'raw']),
  }),
  // Emitted as the trace runs (populates the Trace tab)
  z.object({
    t: z.literal('trace'),
    event: TraceEventSchema,
  }),
  // Emitted after the answer finishes (populates the Fact chips)
  z.object({
    t: z.literal('claim'),
    claim: ClaimEventSchema,
  }),
  // Final event to close the turn
  z.object({
    t: z.literal('done'),
    elapsedMs: z.number(),
    sourcesCount: z.number(),
    claimsCount: z.number(),
    costInr: z.literal(0), // Enforced Zero Rupee Law
  }),
  // Error event
  z.object({
    t: z.literal('error'),
    code: z.string(),
    message: z.string(),
  })
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;