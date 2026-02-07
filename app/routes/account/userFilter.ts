import { Hono } from 'hono'

export const userFilterRoute = new Hono()

userFilterRoute.post('/', async (c) => {
  try {
    const data = { filter_id: '0' }
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
