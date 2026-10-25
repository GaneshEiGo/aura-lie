export type CoreResponseType = 'cache' | 'memory' | 'tool' | 'promise';

export interface CoreResponse {
  type: CoreResponseType;
  text: string;
  meta?: Record<string, any>;
}

export interface CacheEntry {
  query: string;
  answer: string;
  timestamp: number;
}

export interface MemoryDoc {
  id: string;
  text: string;
  tokens: string[];
  importance: number;
}

export interface PromiseItem {
  id: string;
  request: string;
  createdAt: number;
  earliestResumeAt: number;
  status: 'queued' | 'fulfilled' | 'failed';
}