import type { Context, Next } from 'hono'
import { getRegistrationByAsToken } from '@/modules/appservice/config'

// In-memory sliding window rate limiter — intentionally kept in-memory for performance.
// Rate limiting must be synchronous and fast; externalizing to Redis would add latency
// to every request. For multi-process deployments, each process maintains its own window.
const windows = new Map<string, { count: number, resetAt: number }>()

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 600 // 600 requests per minute per IP

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of windows) {
    if (now > val.resetAt)
      windows.delete(key)
  }
}, 5 * 60_000)

export async function rateLimitMiddleware(c: Context, next: Next) {
  // Skip rate limiting for application services (unless explicitly rate_limited)
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const asReg = getRegistrationByAsToken(authHeader.slice(7))
    if (asReg && !asReg.rateLimited) {
      await next()
      return
    }
  }

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown'

  const now = Date.now()
  const entry = windows.get(ip)

  if (!entry || now > entry.resetAt) {
    windows.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  }
  else {
    entry.count++
    if (entry.count > MAX_REQUESTS) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return c.json({
        errcode: 'M_LIMIT_EXCEEDED',
        error: 'Too many requests',
        retry_after_ms: entry.resetAt - now,
      }, 429)
    }
  }

  await next()
}
