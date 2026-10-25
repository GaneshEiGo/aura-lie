// === FILE START ===
// packages/canvas/test/document-v2.test.ts
// PRD §14.3 · FR-CANVAS-03 · F-076 · F-277 · T-13.

import { describe, it, expect } from 'vitest';
import {
  toMarkdown,
  toCSV,
  toPortableDocument,
  type AuraDocument,
} from '../src/document-v2.js';

function sampleDoc(): AuraDocument {
  return {
    title: 'Solar Efficiency Report',
    executiveSummary: 'Efficiency rose 4 points across three sources.',
    sections: [
      { heading: 'Background', body: 'Two prior studies covered this.' },
      { heading: 'Method', body: 'Three independent labs, three runs each.' },
    ],
    tables: [
      {
        title: 'Efficiency by lab',
        headers: ['Lab', 'Efficiency %'],
        rows: [
          ['A', '41'],
          ['B', '42'],
        ],
      },
    ],
    figures: [
      { caption: 'Efficiency chart', description: 'A bar chart showing 41 and 42.' },
    ],
    citations: [
      {
        id: 'c1',
        text: 'Lab A preprint',
        sourceUrl: 'https://example.org/a',
        quote: '41 percent',
      },
    ],
    appendix: 'Method notes and raw data tables.',
  };
}

describe('document — toMarkdown renders every section', () => {
  const md = toMarkdown(sampleDoc());

  it('title as H1', () => {
    expect(md).toMatch(/^# Solar Efficiency Report$/m);
  });

  it('executive summary as H2', () => {
    expect(md).toMatch(/^## Executive Summary$/m);
    expect(md).toContain('Efficiency rose 4 points');
  });

  it('each section as H2', () => {
    expect(md).toMatch(/^## Background$/m);
    expect(md).toMatch(/^## Method$/m);
  });

  it('tables section with Markdown table syntax', () => {
    expect(md).toMatch(/^## Tables$/m);
    expect(md).toMatch(/^\| Lab \| Efficiency % \|$/m);
    expect(md).toMatch(/^\| --- \| --- \|$/m);
    expect(md).toMatch(/^\| A \| 41 \|$/m);
  });

  it('figures section', () => {
    expect(md).toMatch(/^## Figures$/m);
    expect(md).toContain('A bar chart');
  });

  it('citations section with numbered list', () => {
    expect(md).toMatch(/^## Citations$/m);
    expect(md).toMatch(/^1\. Lab A preprint — "41 percent" \(https:\/\/example\.org\/a\)$/m);
  });

  it('appendix section', () => {
    expect(md).toMatch(/^## Appendix$/m);
    expect(md).toContain('Method notes and raw data tables.');
  });

  it('deterministic output (same doc → same md twice)', () => {
    expect(toMarkdown(sampleDoc())).toBe(toMarkdown(sampleDoc()));
  });

  it('skips empty optional sections', () => {
    const minimal: AuraDocument = {
      title: 'T',
      executiveSummary: 'ES',
      sections: [],
      tables: [],
      figures: [],
      citations: [],
      appendix: '',
    };
    const m = toMarkdown(minimal);
    expect(m).not.toContain('## Tables');
    expect(m).not.toContain('## Figures');
    expect(m).not.toContain('## Citations');
    expect(m).not.toContain('## Appendix');
  });
});

describe('document — toCSV', () => {
  it('basic table with headers and rows', () => {
    const csv = toCSV({
      title: 'x',
      headers: ['A', 'B'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
    expect(csv).toBe('A,B\n1,2\n3,4');
  });

  it('quotes fields with commas', () => {
    const csv = toCSV({
      title: 'x',
      headers: ['Name', 'Note'],
      rows: [['A', 'one, two']],
    });
    expect(csv).toBe('Name,Note\nA,"one, two"');
  });

  it('doubles embedded quotes', () => {
    const csv = toCSV({
      title: 'x',
      headers: ['Q'],
      rows: [['he said "hi"']],
    });
    expect(csv).toBe('Q\n"he said ""hi"""');
  });

  it('empty headers → empty string', () => {
    const csv = toCSV({ title: 'x', headers: [], rows: [] });
    expect(csv).toBe('');
  });

  it('headers only (no rows) → header row alone', () => {
    const csv = toCSV({ title: 'x', headers: ['A', 'B'], rows: [] });
    expect(csv).toBe('A,B');
  });
});

describe('document — toPortableDocument', () => {
  it('bundles markdown plus one CSV per table', () => {
    const bundle = toPortableDocument(sampleDoc());
    expect(bundle.markdown).toMatch(/^# Solar Efficiency Report$/m);
    expect(bundle.csvs.length).toBe(1);
    expect(bundle.csvs[0]!.title).toBe('Efficiency by lab');
    expect(bundle.csvs[0]!.csv).toContain('Lab,Efficiency %');
  });

  it('document with no tables → empty csvs array', () => {
    const doc: AuraDocument = {
      title: 'T',
      executiveSummary: 'ES',
      sections: [],
      tables: [],
      figures: [],
      citations: [],
      appendix: '',
    };
    expect(toPortableDocument(doc).csvs).toEqual([]);
  });
});

// =============================================================================
// T-13 laptop-safety proof
// =============================================================================
//
// Scans SOURCE files only. Asserts that every import statement comes from a
// relative path. No npm package of any kind — no marked, no markdown-it, no
// papaparse, no xlsx, no docx-preview. The Markdown and CSV renderers are
// hand-rolled specifically so this holds.
//
// Method: extract all `from '...'` specifiers (regex catches single- and
// multi-line imports), then assert every specifier starts with `.`.
// Comments cannot trip this because `from '...'` is not valid comment syntax
// unless it appears inside an import.

describe('document — T-13 source scan (relative imports only)', () => {
  it('document-v2.ts imports only from relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'document-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    const importSpecifiers = Array.from(
      src.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    const external = importSpecifiers.filter((m) => !m.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('canvas-v2.ts imports only from relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'canvas-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    const importSpecifiers = Array.from(
      src.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    const external = importSpecifiers.filter((m) => !m.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('blocks-v2.ts imports only from relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'blocks-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    const importSpecifiers = Array.from(
      src.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    const external = importSpecifiers.filter((m) => !m.startsWith('.'));
    expect(external).toEqual([]);
  });
});
// === FILE END ===