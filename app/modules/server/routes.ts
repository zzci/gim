import { Hono } from 'hono'
import { livekitServiceUrl, serverName } from '@/config'

export const wellKnowClientRoute = new Hono()

wellKnowClientRoute.get('/', async (c) => {
  try {
    const data = {
      'm.homeserver': {
        base_url: `https://${serverName}`,
      },
      'org.matrix.msc2965.authentication': {
        issuer: `https://${serverName}`,
        account: `https://${serverName}/account/`,
      },
      ...(livekitServiceUrl
        ? {
            'org.matrix.msc4143.rtc_foci': [
              {
                type: 'livekit',
                livekit_service_url: livekitServiceUrl,
              },
            ],
          }
        : {}),
    }
    return c.json(data)
  }
  catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})

export const wellKnowServerRoute = new Hono()

wellKnowServerRoute.get('/', async (c) => {
  try {
    return c.json({
      ok: true,
      req: c.req.header(),
      env: process.env,
    })
  }
  catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})

export const versionsRoute = new Hono()

versionsRoute.get('/', (c) => {
  return c.json({
    versions: [
      'v1.1',
      'v1.2',
      'v1.3',
      'v1.4',
      'v1.5',
      'v1.6',
      'v1.7',
      'v1.8',
      'v1.9',
      'v1.10',
      'v1.11',
      'v1.12',
      'v1.13',
    ],
    unstable_features: {
      'org.matrix.msc2965': true, // OIDC-native auth
      'org.matrix.msc3861': true, // delegated OIDC
      'org.matrix.msc3814': true, // dehydrated devices v2
      'org.matrix.simplified_msc3575': true, // sliding sync
    },
  })
})

export const capabilitiesRoute = new Hono()

capabilitiesRoute.get('/', async (c) => {
  try {
    const data = {
      capabilities: {
        'm.room_versions': {
          default: '12',
          available: {
            1: 'stable',
            2: 'stable',
            3: 'stable',
            4: 'stable',
            5: 'stable',
            6: 'stable',
            7: 'stable',
            8: 'stable',
            9: 'stable',
            10: 'stable',
            11: 'stable',
            12: 'stable',
          },
        },
        'm.change_password': {
          enabled: false,
        },
        'm.set_displayname': {
          enabled: false,
        },
        'm.set_avatar_url': {
          enabled: false,
        },
        'm.3pid_changes': {
          enabled: false,
        },
        'm.get_login_token': {
          enabled: false,
        },
      },
    }
    return c.json(data)
  }
  catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
