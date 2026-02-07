import { Hono } from 'hono'

export const capabilitiesRoute = new Hono()

capabilitiesRoute.get('/', async (c) => {
  try {
    const data = {
      capabilities: {
        'm.room_versions': {
          'default': '11',
          'available': {
            '1': 'stable',
            '2': 'stable',
            '3': 'stable',
            '4': 'stable',
            '5': 'stable',
            '6': 'stable',
            '7': 'stable',
            '8': 'stable',
            '9': 'stable',
            '10': 'stable',
            '11': 'stable'
          },
        },
        'm.change_password': {
          enabled: false,
        },
        'm.set_displayname': {
          enabled: true,
        },
        'm.set_avatar_url': {
          enabled: true,
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
