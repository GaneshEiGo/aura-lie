import type { PrivacyLedgerEntry } from './types.js';

/**
 * PRD Section 5.10 & FR-DATA-07: Privacy Ledger
 */
export class PrivacyLedger {
  private entries: PrivacyLedgerEntry[] = [];

  public record(provider: string, bytesSent: number, contentType: string, memorySnippetsCount: number = 0): void {
    this.entries.push({
      timestamp: Date.now(),
      provider,
      bytesSent,
      contentType,
      memorySnippetsCount
    });
  }

  public getEntries(): ReadonlyArray<PrivacyLedgerEntry> {
    return this.entries;
  }

  public getDailySummary(date: string): { totalBytes: number, providers: string[] } {
    const dayEntries = this.entries.filter(e => new Date(e.timestamp).toISOString().startsWith(date));
    const totalBytes = dayEntries.reduce((sum, e) => sum + e.bytesSent, 0);
    const providers = [...new Set(dayEntries.map(e => e.provider))];
    
    return { totalBytes, providers };
  }
}