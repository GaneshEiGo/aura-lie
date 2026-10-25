import type { CanvasDocument, CanvasBlock } from './types.js';

/**
 * PRD Section 14.3: Canvas and documents.
 * Handles the state of the split-view document builder.
 */
export class CanvasBuilder {
  private document: CanvasDocument;

  constructor(title: string) {
    this.document = {
      id: crypto.randomUUID(),
      title,
      blocks: [],
      lastModified: Date.now()
    };
  }

  public addBlock(block: CanvasBlock): void {
    this.document.blocks.push(block);
    this.document.lastModified = Date.now();
  }

  public updateBlock(id: string, content: string): void {
    const block = this.document.blocks.find(b => b.id === id);
    if (block) {
      block.content = content;
      this.document.lastModified = Date.now();
    }
  }

  public getDocument(): CanvasDocument {
    return this.document;
  }
}