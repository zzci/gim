import { Hono } from 'hono'
import { exchangeRefreshToken } from '@/oauth/tokens'
import { matrixError } from '@/shared/middleware/errors'

export const refreshRoute = new Hono()

refreshRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { refresh_token } = body

  if (!refresh_token) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing refresh_token')
  }

  const result = await exchangeRefreshToken(refresh_token)

  if ('error' in result) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', result.error_description)
  }

  return c.json({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in_ms: result.expires_in * 1000,
  })
})
