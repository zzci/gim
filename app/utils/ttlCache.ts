/**
 * Simple synchronous in-memory cache with TTL expiration.
 * Used for caching hot data like power levels, member counts, display names.
 */
export class TtlCache<T> {
  private cache = new Map<string, { value: T, expiresAt: number }>()

  constructor(private defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry)
      return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix))
        this.cache.delete(key)
    }
  }

  clear(): void {
    this.cache.clear()
  }
}
