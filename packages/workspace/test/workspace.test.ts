import { describe, it, expect } from 'vitest';
import { DocumentExporter } from '../src/exporter.js';
import type { GeneratedDocument } from '../src/types.js';

describe('Document Exporter (PRD 14.3)', () => {
  const exporter = new DocumentExporter();
  
  const mockDoc: GeneratedDocument = {
    title: 'Test Document',
    summary: 'This is a summary.',
    blocks: [
      { type: 'heading', content: 'Introduction', level: 2 },
      { 
        type: 'paragraph', 
        content: 'The efficiency is 41%.', 
        citations: [{ id: 1, text: 'Lab Results', sourceUrl: 'https://example.com/lab' }] 
      },
      { 
        type: 'paragraph', 
        content: 'Solid-state batteries are the future.', 
        citations: [{ id: 2, text: 'Tech News', sourceUrl: 'https://example.com/news' }] 
      }
    ]
  };

  it('should export to Markdown with inline citations', () => {
    const md = exporter.toMarkdown(mockDoc);
    expect(md).toContain('# Test Document');
    expect(md).toContain('> This is a summary.');
    expect(md).toContain('## Introduction');
    expect(md).toContain('The efficiency is 41%. [1]');
    expect(md).toContain('## Citations');
    expect(md).toContain('[1] [Lab Results](https://example.com/lab)');
  });

  it('should export to HTML with linked citations', () => {
    const html = exporter.toHTML(mockDoc);
    expect(html).toContain('<title>Test Document</title>');
    expect(html).toContain('<blockquote>This is a summary.</blockquote>');
    expect(html).toContain('<h2>Introduction</h2>');
    expect(html).toContain('The efficiency is 41%. <a href="#cite-1">[1]</a>');
    expect(html).toContain('<li id="cite-1"><a href="https://example.com/lab"');
  });
});