import { Hono } from 'hono'
import { serverName } from '@/config'
export const wellKnowClientRoute = new Hono()

wellKnowClientRoute.get('/', async (c) => {
  try {
    const data = {
      'm.homeserver': {
        base_url: 'https://' + serverName,
      },
      'org.matrix.msc2965.authentication': {
        issuer: 'https://' + serverName,
        account: 'https://' + serverName + '/account/',
      },
      'org.matrix.msc4143.rtc_foci': [
        {
          type: 'livekit',
          livekit_service_url: 'https://livekit-jwt.call.matrix.org',
        },
      ],
    }
    return c.json(data)
  } catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
