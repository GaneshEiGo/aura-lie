import type { ExportProfile, ExportData, ExportResult } from './types.js';

/**
 * PRD Section 9.9: Export Profiles
 * Handles Full, Shareable, and Anonymised exports.
 */
export class DataExporter {
  public export(profile: ExportProfile, fullData: ExportData): ExportResult {
    const strippedFields: string[] = [];
    const exportData: ExportData = JSON.parse(JSON.stringify(fullData));

    if (profile === 'Full') {
      const bytes = new Blob([JSON.stringify(exportData)]).size;
      return { profile, data: exportData, bytes, strippedFields: [] };
    }

    if (profile === 'Shareable' || profile === 'Anonymised') {
      if (exportData.auditLog) {
        exportData.auditLog = [];
        strippedFields.push('auditLog');
      }
      if (exportData.settings) {
        exportData.settings = {};
        strippedFields.push('settings');
      }
      
      if (exportData.memories) {
        const originalCount = exportData.memories.length;
        exportData.memories = exportData.memories.filter((m: any) => m.sensitivity !== 'S2');
        if (exportData.memories.length !== originalCount) {
          strippedFields.push('S2_Memories');
        }
      }
    }

    if (profile === 'Anonymised') {
      const anonymizeText = (text: string) => {
        if (!text) return text;
        return text
          .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
          .replace(/\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, '[PHONE_REDACTED]')
          .replace(/\b([A-Z][a-z]+) ([A-Z][a-z]+)\b/g, '[NAME_REDACTED]'); 
      };

      if (exportData.chats) {
        exportData.chats = exportData.chats.map((c: any) => ({
          ...c,
          title: anonymizeText(c.title),
          messages: c.messages?.map((m: any) => ({
            ...m,
            content: anonymizeText(m.content)
          }))
        }));
      }
      
      if (exportData.memories) {
        exportData.memories = exportData.memories.map((m: any) => ({
          ...m,
          text: anonymizeText(m.text)
        }));
      }
      
      strippedFields.push('PII_Anonymised');
    }

    const bytes = new Blob([JSON.stringify(exportData)]).size;
    return { profile, data: exportData, bytes, strippedFields };
  }
}