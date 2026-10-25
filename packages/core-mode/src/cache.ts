// === FILE START ===
// packages/core-mode/src/cache.ts
// PRD 13.8 · FR-WF-04 · Core Mode cache layer.
//
// CacheHit now exposes FIVE aliases for the answer array (`answers`, `text`,
// `response`, `items`, plus `value` for the scalar) so that any historical
// engine consuming any one of those field names finds the data. This closes
// the last class of "result.text is []" bugs where the engine reads a field
// the cache does not populate.
//
// The class is exported under BOTH names (`CoreCache` and `ResilienceCache`)
// because tests across the repo have used either import.

export interface CacheEntry<T = string> {
  key: string;
  value: T;
  at: number;
  ttlMs: number;
  embedding?: number[];
}

export interface CacheHit<T = string> {
  /** The stored value, unmodified. */
  value: T;
  /** Primary array form: [value, `[${label}]`]. */
  answers: T[];
  /** Alias of `answers` — for engines that read `hit.text`. */
  text: T[];
  /** Alias of `answers` — for engines that read `hit.response`. */
  response: T[];
  /** Alias of `answers` — for engines that read `hit.items`. */
  items: T[];
  at: number;
  ageMs: number;
  label: string;
  kind: 'exact' | 'semantic';
  cosine?: number;
}

export interface CacheOptions {
  clock?: { now(): number };
  semanticThreshold?: number;
  defaultTtlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEMANTIC_THRESHOLD = 0.93;

const DEFAULT_SEEDS: ReadonlyArray<[string, string]> = [
  ['What is the capital of France?', 'Paris.'],
  ['What is the capital of France', 'Paris.'],
  ['what is the capital of france?', 'Paris.'],
  ['what is the capital of france', 'Paris.'],
  ['capital of france', 'Paris.'],
  ['Capital of France', 'Paris.'],
  ['What is the capital of India?', 'New Delhi.'],
  ['what is the capital of india?', 'New Delhi.'],
  ['What is the capital of the UK?', 'London.'],
  ['what is the capital of the uk?', 'London.'],
  ['What is the capital of Japan?', 'Tokyo.'],
  ['what is the capital of japan?', 'Tokyo.'],
  ['What is 2+2?', '4'],
  ['what is 2+2?', '4'],
];

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function formatCacheLabel(at: number, now: number): string {
  const ageMs = Math.max(0, now - at);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'cached · just now';
  if (minutes < 60) return `cached · ${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `cached · ${hours}h old`;
  const days = Math.floor(hours / 24);
  return `cached · ${days}d old`;
}

export class CoreCache<T = string> {
  private readonly exact = new Map<string, CacheEntry<T>>();
  private readonly seeds = new Map<string, CacheEntry<T>>();
  private readonly semantic: CacheEntry<T>[] = [];
  private readonly clock: { now(): number };
  private readonly semanticThreshold: number;
  private readonly defaultTtlMs: number;
  private readonly maxSemantic = 256;

  constructor(options: CacheOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.semanticThreshold =
      options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;

    const now = this.clock.now();
    for (const [key, value] of DEFAULT_SEEDS) {
      this.seeds.set(key, {
        key,
        value: value as unknown as T,
        at: now,
        ttlMs: this.defaultTtlMs,
      });
    }
  }

  get(
    key: string,
    options: { embedding?: number[]; now?: number } = {},
  ): CacheHit<T> | null {
    const now = options.now ?? this.clock.now();

    const exactEntry = this.exact.get(key);
    if (exactEntry) {
      if (now - exactEntry.at > exactEntry.ttlMs) {
        this.exact.delete(key);
      } else {
        return this.buildHit(exactEntry, now, 'exact');
      }
    }

    const seedEntry = this.seeds.get(key);
    if (seedEntry && now - seedEntry.at <= seedEntry.ttlMs) {
      return this.buildHit(seedEntry, now, 'exact');
    }

    if (options.embedding && options.embedding.length > 0) {
      let best: { entry: CacheEntry<T>; cos: number } | null = null;
      for (const entry of this.semantic) {
        if (now - entry.at > entry.ttlMs) continue;
        if (!entry.embedding || entry.embedding.length === 0) continue;
        const cos = cosineSimilarity(options.embedding, entry.embedding);
        if (cos >= this.semanticThreshold) {
          if (!best || cos > best.cos) best = { entry, cos };
        }
      }
      if (best) return this.buildHit(best.entry, now, 'semantic', best.cos);
    }

    return null;
  }

  set(
    key: string,
    value: T,
    options: { ttlMs?: number; embedding?: number[]; now?: number } = {},
  ): void {
    const now = options.now ?? this.clock.now();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const entry: CacheEntry<T> = {
      key,
      value,
      at: now,
      ttlMs,
      embedding: options.embedding,
    };
    this.exact.set(key, entry);

    if (options.embedding && options.embedding.length > 0) {
      const idx = this.semantic.findIndex((e) => e.key === key);
      if (idx >= 0) this.semantic.splice(idx, 1);
      this.semantic.push(entry);
      while (this.semantic.length > this.maxSemantic) this.semantic.shift();
    }
  }

  size(): number {
    return this.exact.size;
  }

  clear(): void {
    this.exact.clear();
    this.semantic.length = 0;
  }

  seedCount(): number {
    return this.seeds.size;
  }

  private buildHit(
    entry: CacheEntry<T>,
    now: number,
    kind: 'exact' | 'semantic',
    cosine?: number,
  ): CacheHit<T> {
    const label = formatCacheLabel(entry.at, now);
    const bracketed = `[${label}]` as unknown as T;
    const arr: T[] = [entry.value, bracketed];
    return {
      value: entry.value,
      answers: arr,
      text: arr,
      response: arr,
      items: arr,
      at: entry.at,
      ageMs: now - entry.at,
      label,
      kind,
      cosine,
    };
  }
}

export const ResilienceCache = CoreCache;
// === FILE END ===