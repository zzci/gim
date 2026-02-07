import { Hono } from 'hono'
import { serverName } from '@/config'

export const metadataRoute = new Hono()

metadataRoute.get('/', async (c) => {
  try {
    const response = await fetch('https://login.gid.io/oidc/.well-known/openid-configuration')
    if (!response.ok) {
      throw new Error('Failed to fetch OpenID configuration')
    }

    // return response
    const data = (await response.json()) as Record<string, unknown>

    data.registration_endpoint = 'https://' + serverName + '/_matrix/gim/oauth2/registration'

    return c.json(data)
  } catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
