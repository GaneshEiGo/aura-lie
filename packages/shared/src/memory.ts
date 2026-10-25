import { z } from 'zod';

export const MemoryRecordSchema = z.object({
  id: z.string(),
  type: z.enum(['semantic', 'episodic', 'project', 'temporal']),
  text: z.string(),
  origin: z.enum(['USER', 'FILE', 'WEB', 'MODEL', 'DERIVED', 'INFERRED']),
  created: z.string(), // ISO Date
  meta: z.array(z.string()), // e.g. ['source: user-stated', 'confidence: 0.94']
  inferred: z.boolean(),
  sensitivity: z.enum(['S0', 'S1', 'S2']).default('S1'),
  expiresAt: z.string().nullable().optional(),
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;  