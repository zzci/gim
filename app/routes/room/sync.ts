import { Hono } from 'hono'

const data = {
  next_batch: 's66_1358_114_52_171_4_82_97_0_1',
  account_data: {
    events: [
      {
        type: 'org.matrix.msc3890.local_notification_settings.neIjzcFEb6',
        content: {
          is_silenced: false,
        },
      },
    ],
  },
  device_one_time_keys_count: {
    signed_curve25519: 0,
  },
  'org.matrix.msc2732.device_unused_fallback_key_types': [],
  device_unused_fallback_key_types: [],
}

export const syncRoute = new Hono()
let id = 0
syncRoute.get('/', async (c) => {
  try {
    if (id === 0) {
      id++
      return c.json(data)
    }
    c.status(204)
    sleep(10000)
    return c.text('')
  } catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
