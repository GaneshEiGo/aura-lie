export interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string; // 'USER' | 'AURA-LIE' | 'SYSTEM'
  action: string;
  reason: string;
  tool: string;
  inputHash: string;
  outputSummary: string;
  result: 'success' | 'failure';
  prevHash: string;
  hash: string;
}