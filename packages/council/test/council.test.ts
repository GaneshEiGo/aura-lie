import { describe, it, expect, vi } from 'vitest';
import { CouncilEngine } from '../src/engine.js';
import type { CouncilMember } from '../src/types.js';

describe('Council Engine (PRD 7.9)', () => {
  const engine = new CouncilEngine();

  const members: CouncilMember[] = [
    { id: 'm1', name: 'Yuki', role: 'Analyst', modelId: 'groq-70b' },
    { id: 'm2', name: 'Kaito', role: 'Red Team', modelId: 'gemini-pro' }
  ];

  it('should run independent drafts and synthesize', async () => {
    const mockLLM = vi.fn()
      .mockResolvedValueOnce('Yes, the numbers check out.')
      .mockResolvedValueOnce('No, the assumptions are flawed.')
      .mockResolvedValueOnce('Final synthesis: Yes with caveats.');

    const result = await engine.run('Should we invest?', members, mockLLM);

    expect(mockLLM).toHaveBeenCalledTimes(3);
    expect(result.drafts.length).toBe(2);
    expect(result.drafts[0].vote).toBe('yes');
    expect(result.drafts[1].vote).toBe('no');
    expect(result.synthesis).toContain('Final synthesis');
    expect(result.dissentCount).toBe(1);
  });

  it('should label a single-family council as simulated', async () => {
    const simulatedMembers: CouncilMember[] = [
      { id: 'm1', name: 'Yuki', role: 'Analyst', modelId: 'groq-70b' },
      { id: 'm2', name: 'Kaito', role: 'Red Team', modelId: 'groq-8b' }
    ];

    const mockLLM = vi.fn().mockResolvedValue('Mock response');
    const result = await engine.run('Test question', simulatedMembers, mockLLM);

    // Both models are 'groq' family
    expect(result.isSimulated).toBe(true);
  });

  it('should mark multi-family council as independent', async () => {
    const mockLLM = vi.fn().mockResolvedValue('Mock response');
    const result = await engine.run('Test question', members, mockLLM);

    // groq and gemini families
    expect(result.isSimulated).toBe(false);
  });
});