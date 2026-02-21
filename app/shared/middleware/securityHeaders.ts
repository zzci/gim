import type { Context, Next } from 'hono'

const hstsMaxAge = Number(process.env.IM_HSTS_MAX_AGE ?? (process.env.NODE_ENV === 'production' ? '31536000' : '0'))

export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next()

  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Content-Security-Policy', 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; frame-ancestors \'none\'')

  if (hstsMaxAge > 0) {
    c.header('Strict-Transport-Security', `max-age=${hstsMaxAge}; includeSubDomains`)
  }
}
