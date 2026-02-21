import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'
import { serverName } from '@/config'
import { getAccountToken } from '@/modules/account/tokenCache'
import { getRegistrationByAsToken } from '@/modules/appservice/config'
import { getOAuthAccessToken } from '@/oauth/accessTokenCache'

// In-memory sliding window rate limiter — intentionally kept in-memory for performance.
// Rate limiting must be synchronous and fast; externalizing to Redis would add latency
// to every request. For multi-process deployments, each process maintains its own window.
const windows = new Map<string, { count: number, resetAt: number }>()

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 600 // 600 requests per minute per user+device

// Cleanup expired entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, val] of windows) {
    if (now > val.resetAt)
      windows.delete(key)
  }
}, 5 * 60_000)
cleanupTimer.unref()

async function buildRateLimitKey(c: Context, authHeader: string | undefined): Promise<string> {
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    if (token) {
      // AppService token (when rate_limited=true) gets its own bucket.
      const asReg = getRegistrationByAsToken(token)
      if (asReg) {
        return `as:${asReg.id ?? asReg.senderLocalpart}`
      }

      // OAuth AccessToken path.
      const oauth = await getOAuthAccessToken(token)
      if (oauth?.accountId) {
        const userId = oauth.accountId.startsWith('@') ? oauth.accountId : `@${oauth.accountId}:${serverName}`
        return `user:${userId}:device:${oauth.deviceId || 'UNKNOWN'}`
      }

      // Long-lived user token path.
      const userToken = await getAccountToken(token)
      if (userToken) {
        return `user:${userToken.userId}:device:${userToken.deviceId}`
      }

      // Invalid token — isolate by token hash.
      const hash = createHash('sha256').update(token).digest('hex').slice(0, 16)
      return `anon_token:${hash}`
    }
  }

  // Unauthenticated endpoints bucketed by route prefix.
  const parts = c.req.path.split('/').filter(Boolean).slice(0, 4).join('/')
  return `anon_route:${parts || 'root'}`
}

function getClientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export interface RateLimitConfig {
  windowMs?: number
  maxRequests: number
  keyPrefix: string
  keyBy?: 'ip' | 'auth'
}

export function createRateLimitMiddleware(config: RateLimitConfig) {
  const windowMs = config.windowMs ?? WINDOW_MS

  return async function rateLimitHandler(c: Context, next: Next) {
    let key: string
    if (config.keyBy === 'ip') {
      key = `${config.keyPrefix}:${getClientIp(c)}`
    }
    else {
      const authHeader = c.req.header('Authorization')
      const base = await buildRateLimitKey(c, authHeader)
      key = `${config.keyPrefix}:${base}`
    }

    const now = Date.now()
    const entry = windows.get(key)

    if (!entry || now > entry.resetAt) {
      windows.set(key, { count: 1, resetAt: now + windowMs })
    }
    else {
      entry.count++
      if (entry.count > config.maxRequests) {
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
}

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

  const key = await buildRateLimitKey(c, authHeader)

  const now = Date.now()
  const entry = windows.get(key)

  if (!entry || now > entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS })
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

// Pre-built rate limiters for sensitive endpoints
const rateLimitLoginMax = Number(process.env.IM_RATE_LIMIT_LOGIN_MAX) || 10
const rateLimitRegisterMax = Number(process.env.IM_RATE_LIMIT_REGISTER_MAX) || 5

export const loginRateLimit = createRateLimitMiddleware({ maxRequests: rateLimitLoginMax, keyPrefix: 'rl:login', keyBy: 'ip' })
export const registerRateLimit = createRateLimitMiddleware({ maxRequests: rateLimitRegisterMax, keyPrefix: 'rl:register', keyBy: 'ip' })
export const oauthRateLimit = createRateLimitMiddleware({ maxRequests: 20, keyPrefix: 'rl:oauth', keyBy: 'ip' })
export const keysUploadRateLimit = createRateLimitMiddleware({ maxRequests: 60, keyPrefix: 'rl:keys_upload' })
export const keysClaimRateLimit = createRateLimitMiddleware({ maxRequests: 120, keyPrefix: 'rl:keys_claim' })
