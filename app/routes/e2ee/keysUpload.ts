import { Hono } from 'hono'

const data = { one_time_key_counts: { signed_curve25519: 50 } }

export const keysUploadRoute = new Hono()

keysUploadRoute.post('/', async (c) => {
  try {
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
