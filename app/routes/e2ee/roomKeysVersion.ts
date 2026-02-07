import { Hono } from 'hono'

export const roomKeysVersionRoute = new Hono()

roomKeysVersionRoute.get('/', async (c) => {
  try {
    const data = {
      auth_data: {
        public_key: 'NeVhXXu4lE9v0Z1FW/9BzpUoZbgiqsy1Iw6qDGYumnc',
        signatures: {
          '@roy:a.g.im': {
            'ed25519:m3IlYj9opp':
              'uCygrYBev1K5AXEzwTo6ZLXE96tyJAHUvwY6Ef3e4ncRhsTe5fWf+KDmepBBYUcrOIbG6fzIpyrWcExpBjNfCw',
            'ed25519:ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI':
              'llE6syyliK4lZf/nPP4OGuwTmK0hefhu9xRrMCT1viPbBeacvHZ8mAzsFG6tUTU/ZMgoWV5aEYh1tcho+Uk/Dg',
          },
        },
      },
      version: '3',
      algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2',
      etag: '1',
      count: 8,
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
