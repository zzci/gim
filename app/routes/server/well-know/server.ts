import { Hono } from 'hono'

export const wellKnowServerRoute = new Hono()

wellKnowServerRoute.get('/', async (c) => {
  try {
    return c.json({
      ok: true,
      req: c.req.header(),
      env: process.env,
    })
  } catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
