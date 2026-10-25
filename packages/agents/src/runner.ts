import type { Mission, MissionResult } from './types.js';
import { StopConditions } from './stop-conditions.js';

export class AgentRunner {
  public async runStep(mission: Mission): Promise<MissionResult> {
    const now = Date.now();
    if (!mission.startedAt) mission.startedAt = now;

    const check = StopConditions.shouldStop(mission, now);

    if (check.stop) {
      let newStatus: Mission['status'] = 'COMPLETED';
      if (check.reason === 'Permission required') newStatus = 'NEEDS_APPROVAL';
      else if (check.reason === 'Iteration limit reached' || check.reason === 'Time limit exceeded') newStatus = 'FAILED';

      mission.status = newStatus;
      return {
        missionId: mission.id,
        status: mission.status,
        completedSteps: mission.cursor,
        error: newStatus === 'FAILED' ? check.reason : undefined
      };
    }

    // Execute the step (simulated here, would call ToolRegistry)
    const step = mission.steps[mission.cursor];
    
    // Simulate tool execution
    await new Promise(resolve => setTimeout(resolve, 10));

    // Move cursor
    mission.cursor += 1;

    // Check if we reached the end
    if (mission.cursor >= mission.steps.length) {
      mission.status = 'COMPLETED';
    } else {
      mission.status = 'RUNNING';
    }

    return {
      missionId: mission.id,
      status: mission.status,
      completedSteps: mission.cursor
    };
  }

  public approveStep(mission: Mission): void {
    if (mission.status === 'NEEDS_APPROVAL') {
      mission.steps[mission.cursor].requiresApproval = false;
      mission.status = 'RUNNING';
    }
  }
}