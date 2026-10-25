import type { ModelAdapter, RouterRequest, RouteSelection } from './types.js';
import { RouterError } from './types.js';
import { CircuitBreaker } from './circuit-breaker.js';

export class Router {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private registry: ModelAdapter[]) {}

  private getBreaker(modelId: string): CircuitBreaker {
    if (!this.breakers.has(modelId)) {
      this.breakers.set(modelId, new CircuitBreaker());
    }
    return this.breakers.get(modelId)!;
  }

  public select(request: RouterRequest): RouteSelection {
    let candidates = this.registry.filter(model => {
      if (!model.roles.includes(request.role)) return false;
      if (request.sensitivity === 'S2' && model.lane !== 'private') return false;
      if (request.promptLength > model.contextWindow * 0.6) return false;
      if (!this.getBreaker(model.id).isAvailable()) return false;
      return true;
    });

    if (candidates.length === 0) {
      throw new RouterError(`No models available for role: ${request.role} (Sensitivity: ${request.sensitivity})`);
    }

    candidates.sort((a, b) => b.health - a.health);

    let primary = candidates[0];
    let reason = `Best health match (${primary.health}) in ${primary.lane} lane.`;

    if (request.preferDiversity && candidates.length > 1) {
      const diverseCandidate = candidates.find(c => c.provider !== primary.provider);
      if (diverseCandidate) {
        primary = diverseCandidate;
        reason = `Diversity requested: selected ${primary.provider} instead of ${candidates[0].provider}.`;
      }
    }

    const fallbackChain = candidates.filter(c => c.id !== primary.id);

    return {
      model: primary,
      reason,
      fallbackChain
    };
  }

  public reportSuccess(modelId: string): void {
    this.getBreaker(modelId).recordSuccess();
  }

  public reportFailure(modelId: string): void {
    this.getBreaker(modelId).recordFailure();
  }
}

export { Router as ModelRouter };