import type { Storage, StorageValue } from 'unstorage'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

let _cache: Storage | null = null

async function resolveCache(): Promise<Storage> {
  if (_cache)
    return _cache

  const driver = process.env.IM_CACHE_DRIVER === 'redis' && process.env.REDIS_URL
    ? (await import('unstorage/drivers/redis')).default({ url: process.env.REDIS_URL })
    : memoryDriver()

  _cache = createStorage({ driver })
  return _cache
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const s = await resolveCache()
  return await s.getItem<T>(key) ?? null
}

export async function cacheSet(key: string, value: StorageValue, opts?: { ttl?: number }): Promise<void> {
  const s = await resolveCache()
  await s.setItem(key, value, opts?.ttl ? { ttl: opts.ttl } : undefined)
}

export async function cacheDel(key: string): Promise<void> {
  const s = await resolveCache()
  await s.removeItem(key)
}

export async function cacheHas(key: string): Promise<boolean> {
  const s = await resolveCache()
  return await s.hasItem(key)
}

export async function cacheDelPrefix(prefix: string): Promise<void> {
  const s = await resolveCache()
  const keys = await s.getKeys(prefix)
  await Promise.all(keys.map(k => s.removeItem(k)))
}

export async function closeCache(): Promise<void> {
  if (_cache) {
    await _cache.dispose()
    _cache = null
  }
}
