export interface Citation {
  id: number;
  text: string;
  sourceUrl: string;
}

export type BlockType = 'paragraph' | 'table' | 'code' | 'heading';

export interface DocumentBlock {
  type: BlockType;
  content: string;
  level?: number; // For headings
  citations?: Citation[];
}

export interface GeneratedDocument {
  title: string;
  summary: string;
  blocks: DocumentBlock[];
}