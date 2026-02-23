import { cacheGet } from '@/cache'

/**
 * Retrieves data from storage by key, with optional sub-key access.
 */
export async function getStorage(
  key: string,
  subKey?: string,
): Promise<Record<string, any> | undefined> {
  const data = await cacheGet<Record<string, any>>(key)
  if (!data)
    return undefined
  return subKey ? data[subKey] : data
}
