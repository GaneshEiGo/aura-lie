import type { AuditEntry } from './types.js';

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private readonly GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Simple synchronous hash for tamper-evidence demonstration.
   * In production, this would use crypto.subtle.digest('SHA-256', ...).
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0'); // Pad to simulate SHA-256
  }

  public log(
    actor: string,
    action: string,
    reason: string,
    tool: string,
    inputHash: string,
    outputSummary: string,
    result: 'success' | 'failure'
  ): AuditEntry {
    const prevHash = this.entries.length > 0 ? this.entries[this.entries.length - 1].hash : this.GENESIS_HASH;
    
    const entryData = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      actor,
      action,
      reason,
      tool,
      inputHash,
      outputSummary,
      result,
      prevHash
    };

    const hash = this.hashString(JSON.stringify(entryData));
    const entry: AuditEntry = { ...entryData, hash };
    
    this.entries.push(entry);
    return entry;
  }

  public getEntries(): ReadonlyArray<AuditEntry> {
    return this.entries;
  }

  public verifyChain(): boolean {
    let currentPrevHash = this.GENESIS_HASH;
    
    for (const entry of this.entries) {
      if (entry.prevHash !== currentPrevHash) {
        return false; // Chain broken
      }
      
      const { hash, ...entryData } = entry;
      const expectedHash = this.hashString(JSON.stringify(entryData));
      
      if (hash !== expectedHash) {
        return false; // Tampered entry
      }
      
      currentPrevHash = entry.hash;
    }
    
    return true;
  }
}