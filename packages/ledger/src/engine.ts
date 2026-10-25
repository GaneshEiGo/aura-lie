import type { LedgerClaim, ScoreHistoryEntry, ClaimStatus } from './types.js';

/**
 * PRD FR-TRUTH-23: Claim Ledger.
 * Keeps an immutable history of every claim made and its score changes.
 */
export class ClaimLedger {
  private claims = new Map<string, LedgerClaim>();

  public recordClaim(
    id: string, 
    text: string, 
    initialScore: number | null, 
    initialStatus: ClaimStatus
  ): LedgerClaim {
    const claim: LedgerClaim = {
      id,
      text,
      score: initialScore,
      status: initialStatus,
      lastChecked: Date.now(),
      history: initialScore !== null ? [{
        score: initialScore,
        status: initialStatus,
        timestamp: Date.now(),
        reason: 'Initial verification'
      }] : []
    };

    this.claims.set(id, claim);
    return claim;
  }

  public updateScore(
    id: string, 
    newScore: number | null, 
    newStatus: ClaimStatus, 
    reason: string
  ): LedgerClaim | undefined {
    const claim = this.claims.get(id);
    if (!claim) return undefined;

    claim.score = newScore;
    claim.status = newStatus;
    claim.lastChecked = Date.now();

    if (newScore !== null) {
      claim.history.push({
        score: newScore,
        status: newStatus,
        timestamp: Date.now(),
        reason
      });
    }

    return claim;
  }

  public getClaim(id: string): LedgerClaim | undefined {
    return this.claims.get(id);
  }

  public search(query: string): LedgerClaim[] {
    const lowerQuery = query.toLowerCase();
    const results: LedgerClaim[] = [];
    
    for (const claim of this.claims.values()) {
      if (claim.text.toLowerCase().includes(lowerQuery)) {
        results.push(claim);
      }
    }
    
    return results;
  }

  public getAll(): LedgerClaim[] {
    return Array.from(this.claims.values());
  }
}