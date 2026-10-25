export interface CanvasBlock {
  id: string;
  type: 'paragraph' | 'code' | 'table' | 'heading';
  content: string;
  meta?: Record<string, any>;
}

export interface CanvasDocument {
  id: string;
  title: string;
  blocks: CanvasBlock[];
  lastModified: number;
}