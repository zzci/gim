import type { Context, Next } from 'hono'

const VALID_REQUEST_ID = /^[\w\-.]{1,64}$/

export async function requestIdMiddleware(c: Context, next: Next) {
  const header = c.req.header('X-Request-Id')
  const id = header && VALID_REQUEST_ID.test(header) ? header : crypto.randomUUID()
  c.set('requestId', id)
  c.set('requestStart', Date.now())
  c.header('X-Request-Id', id)
  await next()
}
