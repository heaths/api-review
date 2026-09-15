export interface CacheEntry<T> {
  readonly value: T;
  readonly etag?: string;
  readonly fetchedAt: number;
  readonly size?: number;
  readonly lastAccessedAt?: number;
}

export interface CacheStore {
  get<T>(key: string): CacheEntry<T> | undefined;
  set<T>(key: string, entry: CacheEntry<T>): void;
  delete(key: string): void;
  clear(): void;
}

export interface MemoryCacheOptions {
  readonly maxSize?: number;
  readonly now?: () => number;
  readonly sizeCalculation?: <T>(key: string, entry: CacheEntry<T>) => number;
}

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly now: () => number;
  private readonly sizeCalculation: <T>(key: string, entry: CacheEntry<T>) => number;
  private currentSize = 0;

  public constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = normalizeMaxSize(options.maxSize);
    this.now = options.now ?? (() => Date.now());
    this.sizeCalculation = options.sizeCalculation ?? calculateCacheEntrySize;
  }

  public get<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    const accessedAt = this.now();
    if (entry.lastAccessedAt === accessedAt) {
      return entry as CacheEntry<T>;
    }

    const refreshed = {
      ...entry,
      lastAccessedAt: accessedAt,
    };
    this.entries.set(key, refreshed);
    return refreshed as CacheEntry<T>;
  }

  public set<T>(key: string, entry: CacheEntry<T>): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.currentSize -= existing.size ?? 0;
    }

    const normalized = normalizeCacheEntry(key, entry, this.now(), this.sizeCalculation);
    this.entries.set(key, normalized as CacheEntry<unknown>);
    this.currentSize += normalized.size ?? 0;
    this.evictIfNeeded();
  }

  public delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.currentSize -= entry.size ?? 0;
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
    this.currentSize = 0;
  }

  private evictIfNeeded(): void {
    while (this.currentSize > this.maxSize && this.entries.size > 0) {
      const oldest = findOldestEntry(this.entries);
      if (!oldest) {
        return;
      }

      this.currentSize -= oldest.entry.size ?? 0;
      this.entries.delete(oldest.key);
    }
  }
}

function normalizeMaxSize(maxSize: number | undefined): number {
  if (maxSize === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(maxSize) || maxSize < 0) {
    throw new Error(`Cache maxSize must be a non-negative finite number, got ${String(maxSize)}.`);
  }
  return Math.floor(maxSize);
}

function normalizeCacheEntry<T>(
  key: string,
  entry: CacheEntry<T>,
  now: number,
  sizeCalculation: <U>(key: string, cacheEntry: CacheEntry<U>) => number,
): CacheEntry<T> {
  const lastAccessedAt = entry.lastAccessedAt ?? now;
  const normalized = {
    ...entry,
    lastAccessedAt,
  };
  const size = entry.size ?? sizeCalculation(key, normalized);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Cache entry size must be a non-negative finite number, got ${String(size)}.`);
  }

  return {
    ...normalized,
    size: Math.floor(size),
  };
}

function calculateCacheEntrySize<T>(key: string, entry: CacheEntry<T>): number {
  return encodeSize(JSON.stringify({
    key,
    value: entry.value,
    etag: entry.etag,
    fetchedAt: entry.fetchedAt,
    lastAccessedAt: entry.lastAccessedAt,
  }));
}

function encodeSize(value: string): number {
  return new TextEncoder().encode(value).length;
}

function findOldestEntry(
  entries: ReadonlyMap<string, CacheEntry<unknown>>,
): { readonly key: string; readonly entry: CacheEntry<unknown> } | undefined {
  let candidateKey: string | undefined;
  let candidateEntry: CacheEntry<unknown> | undefined;

  for (const [key, entry] of entries) {
    if (!candidateEntry || compareCacheEntries(entry, key, candidateEntry, candidateKey ?? '') < 0) {
      candidateKey = key;
      candidateEntry = entry;
    }
  }

  return candidateKey && candidateEntry ? { key: candidateKey, entry: candidateEntry } : undefined;
}

function compareCacheEntries(
  left: CacheEntry<unknown>,
  leftKey: string,
  right: CacheEntry<unknown>,
  rightKey: string,
): number {
  return compareNumbers(left.lastAccessedAt, right.lastAccessedAt)
    || compareNumbers(left.fetchedAt, right.fetchedAt)
    || leftKey.localeCompare(rightKey);
}

function compareNumbers(left: number | undefined, right: number | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return left - right;
}
