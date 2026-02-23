import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { livekitServiceUrl } from '@/config'
import { authMiddleware } from '@/shared/middleware/auth'

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
