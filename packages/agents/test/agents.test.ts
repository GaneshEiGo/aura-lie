import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/runner.js';
import type { Mission } from '../src/types.js';

describe('Agent Mission Runner (PRD 10.9)', () => {
  const runner = new AgentRunner();

  const createMission = (overrides: Partial<Mission> = {}): Mission => ({
    id: 'mission-1',
    goal: 'Research solid state batteries',
    steps: [
      { id: 's1', description: 'Search web', toolId: 'search', requiresApproval: false },
      { id: 's2', description: 'Fetch page', toolId: 'fetch', requiresApproval: false }
    ],
    cursor: 0,
    status: 'PENDING',
    maxSteps: 5,
    timeoutMs: 10000,
    ...overrides
  });

  it('should execute a step and advance the cursor', async () => {
    const mission = createMission();
    const result = await runner.runStep(mission);
    
    expect(result.status).toBe('RUNNING');
    expect(result.completedSteps).toBe(1);
    expect(mission.cursor).toBe(1);
  });

  it('should complete the mission when all steps are done', async () => {
    const mission = createMission({ cursor: 2 });
    const result = await runner.runStep(mission);
    
    expect(result.status).toBe('COMPLETED');
    expect(result.completedSteps).toBe(2);
  });

  it('should pause and require approval for restricted steps', async () => {
    const mission = createMission({ 
      steps: [{ id: 's1', description: 'Delete files', toolId: 'delete', requiresApproval: true }] 
    });
    
    const result = await runner.runStep(mission);
    
    expect(result.status).toBe('NEEDS_APPROVAL');
    expect(result.completedSteps).toBe(0);
    expect(mission.status).toBe('NEEDS_APPROVAL');

    // Approve and resume
    runner.approveStep(mission);
    const result2 = await runner.runStep(mission);
    expect(result2.status).toBe('COMPLETED');
  });

  it('should fail if time limit is exceeded', async () => {
    const mission = createMission({ startedAt: Date.now() - 20000, timeoutMs: 10000 });
    const result = await runner.runStep(mission);
    
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Time limit exceeded');
  });
});