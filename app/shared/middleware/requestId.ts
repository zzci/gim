import type { Context, Next } from 'hono'

export async function requestIdMiddleware(c: Context, next: Next) {
  const id = c.req.header('X-Request-Id') || crypto.randomUUID()
  c.set('requestId', id)
  c.set('requestStart', Date.now())
  c.header('X-Request-Id', id)
  await next()
}
