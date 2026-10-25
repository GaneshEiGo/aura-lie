// === FILE START ===
// packages/canvas/src/document-v2.ts
// PRD §14.3 · FR-CANVAS-03 · F-076 · F-277 · T-13.
//
// Document mode: title, executive summary, sections, tables, figures,
// citations, appendix — exportable as Markdown and CSV, purely client-side.
//
// PRD §14.3:
//   "Document mode: 'Turn this into a formal report': title, executive
//    summary, sections, tables, figures, citations, appendix. Citations
//    come from real claim evidence."
//   "Export: Markdown and CSV in v1. PDF through the browser's print
//    stylesheet, so there is no heavy library."
//
// FR-CANVAS-03 says "Exports open correctly in Word/Reader" — Markdown
// satisfies this (paste-into-Word accepts Markdown). We do NOT ship a DOCX
// library; F-277 lists DOCX as W6 P2, and v1's deliverable is MD + CSV.
//
// T-13 laptop-safety: only relative imports. Zero npm dependencies. No
// markdown-it, marked, papaparse, xlsx, docx-preview. A source-scan test
// asserts this.

// -----------------------------------------------------------------------------
// Document model
// -----------------------------------------------------------------------------

export interface DocSection {
  heading: string;
  body: string;
}

export interface DocTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface DocFigure {
  caption: string;
  /** Descriptive text only; images stay in the browser's own blob store. */
  description: string;
}

export interface DocCitation {
  id: string;
  text: string;
  sourceUrl?: string;
  quote?: string;
}

export interface AuraDocument {
  title: string;
  executiveSummary: string;
  sections: DocSection[];
  tables: DocTable[];
  figures: DocFigure[];
  citations: DocCitation[];
  appendix: string;
}

// -----------------------------------------------------------------------------
// Markdown renderer (hand-rolled, no library)
// -----------------------------------------------------------------------------

export function toMarkdown(doc: AuraDocument): string {
  const blocks: string[] = [];

  blocks.push(`# ${doc.title}`);
  blocks.push('');
  blocks.push('## Executive Summary');
  blocks.push('');
  blocks.push(doc.executiveSummary);
  blocks.push('');

  for (const section of doc.sections) {
    blocks.push(`## ${section.heading}`);
    blocks.push('');
    blocks.push(section.body);
    blocks.push('');
  }

  if (doc.tables.length > 0) {
    blocks.push('## Tables');
    blocks.push('');
    for (const t of doc.tables) {
      blocks.push(`### ${t.title}`);
      blocks.push('');
      blocks.push(toMarkdownTable(t));
      blocks.push('');
    }
  }

  if (doc.figures.length > 0) {
    blocks.push('## Figures');
    blocks.push('');
    for (const f of doc.figures) {
      blocks.push(`### ${f.caption}`);
      blocks.push('');
      blocks.push(f.description);
      blocks.push('');
    }
  }

  if (doc.citations.length > 0) {
    blocks.push('## Citations');
    blocks.push('');
    doc.citations.forEach((c, i) => {
      const quotePart = c.quote ? ` — "${c.quote}"` : '';
      const urlPart = c.sourceUrl ? ` (${c.sourceUrl})` : '';
      blocks.push(`${i + 1}. ${c.text}${quotePart}${urlPart}`);
    });
    blocks.push('');
  }

  if (doc.appendix && doc.appendix.length > 0) {
    blocks.push('## Appendix');
    blocks.push('');
    blocks.push(doc.appendix);
    blocks.push('');
  }

  // Normalise trailing newline; deterministic output for a given input.
  return `${blocks.join('\n').trim()}\n`;
}

function toMarkdownTable(t: DocTable): string {
  if (t.headers.length === 0) return '';
  const headerRow = `| ${t.headers.join(' | ')} |`;
  const separatorRow = `| ${t.headers.map(() => '---').join(' | ')} |`;
  const bodyRows = t.rows.map((r) => `| ${r.join(' | ')} |`);
  return [headerRow, separatorRow, ...bodyRows].join('\n');
}

// -----------------------------------------------------------------------------
// CSV renderer (RFC 4180-esque, hand-rolled, no library)
// -----------------------------------------------------------------------------

/**
 * Emit RFC-4180-style CSV for one table. Fields containing a comma, quote,
 * or newline are double-quoted, and any embedded `"` is doubled.
 *
 * Empty headers → empty string (a table with no headers is not a table).
 * Empty rows → header-only output.
 */
export function toCSV(table: DocTable): string {
  if (table.headers.length === 0) return '';
  const rows: string[] = [];
  rows.push(table.headers.map(escapeField).join(','));
  for (const row of table.rows) {
    rows.push(row.map(escapeField).join(','));
  }
  return rows.join('\n');
}

function escapeField(s: string): string {
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// -----------------------------------------------------------------------------
// Portable export bundle
// -----------------------------------------------------------------------------

export interface PortableDocument {
  /** The Markdown body (print to PDF via the browser). */
  markdown: string;
  /** One CSV per table in the document. */
  csvs: { title: string; csv: string }[];
}

export function toPortableDocument(doc: AuraDocument): PortableDocument {
  return {
    markdown: toMarkdown(doc),
    csvs: doc.tables.map((t) => ({ title: t.title, csv: toCSV(t) })),
  };
}
// === FILE END ===