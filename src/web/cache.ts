export interface CacheEntry<T> {
  readonly value: T;
  readonly etag?: string;
  readonly fetchedAt: number;
}

export interface CacheStore {
  get<T>(key: string): CacheEntry<T> | undefined;
  set<T>(key: string, entry: CacheEntry<T>): void;
  delete(key: string): void;
  clear(): void;
}

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  public get<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    return entry as CacheEntry<T> | undefined;
  }

  public set<T>(key: string, entry: CacheEntry<T>): void {
    this.entries.set(key, entry as CacheEntry<unknown>);
  }

  public delete(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }
}
