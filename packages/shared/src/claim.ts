import { z } from 'zod';

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(['numeric', 'date', 'entity-relation', 'definition', 'causal', 'comparison', 'forecast', 'opinion']),
  checkable: z.boolean(),
  importance: z.enum(['central', 'supporting']),
  volatility: z.enum(['stable', 'slow', 'fast']),
  origin: z.enum(['USER', 'FILE', 'WEB', 'MODEL', 'DERIVED', 'INFERRED', 'UNKNOWN']),
  status: z.enum(['VERIFIED', 'SUPPORTED', 'MIXED', 'WEAK', 'CONFLICTED', 'UNVERIFIED', 'RECALL_ONLY', 'NOT_SCORED']),
  score: z.number().nullable(),
});

export type Claim = z.infer<typeof ClaimSchema>;