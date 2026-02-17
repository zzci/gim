import { Hono } from 'hono'
import { serverName } from '@/config'
import { isUserInExclusiveNamespace } from '@/modules/appservice/config'
import { matrixError } from '@/shared/middleware/errors'

export const registerRoute = new Hono()

registerRoute.post('/', async (c) => {
  let body: Record<string, unknown> = {}
  try {
    body = await c.req.json()
  }
  catch {
    // No body or invalid JSON
  }

  // Check if username falls in an exclusive AS namespace
  const username = body.username as string | undefined
  if (username) {
    const userId = username.startsWith('@') ? username : `@${username}:${serverName}`
    const exclusiveAs = isUserInExclusiveNamespace(userId)
    if (exclusiveAs) {
      return matrixError(c, 'M_EXCLUSIVE', 'This username is reserved by an application service')
    }
  }

  return c.json({
    errcode: 'M_FORBIDDEN',
    error: 'Registration is disabled on this server. Use SSO to sign in.',
    flows: [],
  }, 401)
})
