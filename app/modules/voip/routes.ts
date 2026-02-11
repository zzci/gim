import type { AuthEnv } from '@/shared/middleware/auth'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { livekitServiceUrl, turnSharedSecret, turnTtl, turnUris } from '@/config'
import { authMiddleware } from '@/shared/middleware/auth'

// GET /_matrix/client/v3/voip/turnServer
export const turnServerRoute = new Hono<AuthEnv>()

turnServerRoute.get('/', authMiddleware, (c) => {
  const uris = turnUris ? turnUris.split(',').map(s => s.trim()).filter(Boolean) : []

  if (!uris.length || !turnSharedSecret) {
    // No TURN configured — return empty object (matches Synapse behavior)
    return c.json({})
  }

  const { userId } = c.get('auth')
  const expiry = Math.floor(Date.now() / 1000) + turnTtl
  const username = `${expiry}:${userId}`
  const password = createHmac('sha1', turnSharedSecret).update(username).digest('base64')

  return c.json({
    username,
    password,
    uris,
    ttl: turnTtl,
  })
})

// GET /_matrix/client/v1/rtc/transports (MSC4143)
export const rtcTransportsRoute = new Hono<AuthEnv>()

rtcTransportsRoute.get('/', authMiddleware, (c) => {
  const transports: { type: string, livekit_service_url: string }[] = []

  if (livekitServiceUrl) {
    transports.push({
      type: 'livekit',
      livekit_service_url: livekitServiceUrl,
    })
  }

  return c.json({ rtc_transports: transports })
})
