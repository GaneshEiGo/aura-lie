export type ExportProfile = 'Full' | 'Shareable' | 'Anonymised';

export interface ExportData {
  chats: any[];
  memories: any[];
  claims: any[];
  settings: any;
  auditLog: any[];
  [key: string]: any;
}

export interface ExportResult {
  profile: ExportProfile;
  data: ExportData;
  bytes: number;
  strippedFields: string[];
}

export interface PrivacyLedgerEntry {
  timestamp: number;
  provider: string;
  bytesSent: number;
  contentType: string;
  memorySnippetsCount: number;
}