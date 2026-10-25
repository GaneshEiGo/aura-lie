export type Locale = 'en' | 'hi';

export type CopyKey = 
  | 'home.headline'
  | 'home.subline'
  | 'fact.verified'
  | 'fact.conflicted'
  | 'fact.recall'
  | 'quota.low'
  | 'core.mode'
  | 'error.generic';

export interface Dictionary {
  [key: string]: string;
}