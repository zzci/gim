import type { Context, Next } from 'hono'
import { recordRequest } from '@/shared/metrics'

export async function requestLogMiddleware(c: Context, next: Next) {
  await next()

  const status = c.res.status
  const start = c.get('requestStart') as number | undefined
  const duration = start ? Date.now() - start : 0
  const requestId = c.get('requestId') as string | undefined
  const auth = c.get('auth') as { userId?: string, deviceId?: string } | undefined
  const method = c.req.method
  const path = c.req.path

  recordRequest(method, status)

  // Sync long-poll timeouts with empty response are noise
  if (path.includes('/sync') && duration > 25000 && status === 200) {
    logger.debug('sync_timeout', { requestId, userId: auth?.userId, duration, method, path, status })
    return
  }

  const meta: Record<string, unknown> = { requestId, method, path, status, duration }
  if (auth?.userId)
    meta.userId = auth.userId
  if (auth?.deviceId)
    meta.deviceId = auth.deviceId

  if (status >= 500) {
    logger.error('request', meta)
  }
  else if (status === 401 || status === 403 || status === 429) {
    logger.warn('request', meta)
  }
  else {
    logger.info('request', meta)
  }
}
