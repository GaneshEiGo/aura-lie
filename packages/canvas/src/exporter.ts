import type { CanvasDocument } from './types.js';

export class CanvasExporter {
  public toMarkdown(doc: CanvasDocument): string {
    let md = `# ${doc.title}\n\n`;

    for (const block of doc.blocks) {
      if (block.type === 'heading') {
        md += `## ${block.content}\n\n`;
      } else if (block.type === 'paragraph') {
        md += `${block.content}\n\n`;
      } else if (block.type === 'code') {
        md += `\`\`\`${block.meta?.language || ''}\n${block.content}\n\`\`\`\n\n`;
      } else if (block.type === 'table') {
        md += `${block.content}\n\n`;
      }
    }

    return md;
  }
}