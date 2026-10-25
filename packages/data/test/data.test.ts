import { describe, it, expect } from 'vitest';
import { DataExporter } from '../src/exporter.js';
import { DataWiper } from '../src/wiper.js';
import { PrivacyLedger } from '../src/privacy-ledger.js';
import type { ExportData } from '../src/types.js';

describe('Data Portability (PRD 9.9)', () => {
  const exporter = new DataExporter();
  const wiper = new DataWiper();
  const ledger = new PrivacyLedger();

  const mockData: ExportData = {
    chats: [{ title: "My Chat with john@example.com", messages: [{ content: "My phone is 123-456-7890" }] }],
    memories: [
      { text: "Prefers dark mode", sensitivity: "S0" },
      { text: "Has depression", sensitivity: "S2" }
    ],
    claims: [],
    settings: { theme: "dark" },
    auditLog: [{ action: "login" }]
  };

  it('should export Full profile without modification', () => {
    const result = exporter.export('Full', mockData);
    expect(result.data.memories.length).toBe(2);
    expect(result.strippedFields.length).toBe(0);
  });

  it('should strip S2 memories and audit logs for Shareable profile', () => {
    const result = exporter.export('Shareable', mockData);
    expect(result.data.memories.length).toBe(1); // S2 stripped
    expect(result.data.memories[0].text).toBe("Prefers dark mode");
    expect(result.data.auditLog.length).toBe(0);
    expect(result.strippedFields).toContain('S2_Memories');
  });

  it('should anonymise PII for Anonymised profile', () => {
    const result = exporter.export('Anonymised', mockData);
    expect(result.data.chats[0].title).toContain('[EMAIL_REDACTED]');
    expect(result.data.chats[0].messages[0].content).toContain('[PHONE_REDACTED]');
  });

  it('should require WIPE confirmation word', async () => {
    const res = await wiper.wipeAll('delete', {});
    expect(res.success).toBe(false);
    expect(res.message).toContain('Invalid confirmation');
  });

  it('should track privacy ledger entries', () => {
    ledger.record('Groq', 150, 'prompt', 1);
    ledger.record('Gemini', 200, 'prompt', 0);
    
    const entries = ledger.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].provider).toBe('Groq');
    expect(entries[0].bytesSent).toBe(150);
  });
});