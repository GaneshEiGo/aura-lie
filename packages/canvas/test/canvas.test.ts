import { describe, it, expect } from 'vitest';
import { CanvasBuilder } from '../src/builder.js';
import { CanvasExporter } from '../src/exporter.js';

describe('Canvas & Document Builder (PRD 14.3)', () => {
  const exporter = new CanvasExporter();

  it('should build a document and track changes', () => {
    const builder = new CanvasBuilder('Test Document');
    expect(builder.getDocument().title).toBe('Test Document');

    builder.addBlock({
      id: 'b1',
      type: 'paragraph',
      content: 'Initial content.'
    });

    const doc = builder.getDocument();
    expect(doc.blocks.length).toBe(1);
    expect(doc.blocks[0].content).toBe('Initial content.');
  });

  it('should update an existing block', () => {
    const builder = new CanvasBuilder('Test Document');
    builder.addBlock({ id: 'b1', type: 'paragraph', content: 'Old text.' });
    
    builder.updateBlock('b1', 'New text.');
    
    const doc = builder.getDocument();
    expect(doc.blocks[0].content).toBe('New text.');
  });

  it('should export to Markdown', () => {
    const builder = new CanvasBuilder('Research Report');
    builder.addBlock({ id: 'b1', type: 'heading', content: 'Introduction' });
    builder.addBlock({ id: 'b2', type: 'paragraph', content: 'The efficiency is 41%.' });
    builder.addBlock({ id: 'b3', type: 'code', content: 'const x = 41;', meta: { language: 'javascript' } });

    const doc = builder.getDocument();
    const md = exporter.toMarkdown(doc);

    expect(md).toContain('# Research Report');
    expect(md).toContain('## Introduction');
    expect(md).toContain('The efficiency is 41%.');
    expect(md).toContain('```javascript\nconst x = 41;\n```');
  });
});