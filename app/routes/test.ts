import { Hono } from 'hono'

export const testRoute = new Hono()

testRoute.get('/', async (c) => {
  try {
    const keys = await storage.keys()
    const time = await storage.get('test')
    const data = { time, keys }
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

testRoute.get('/a', async (c) => {
  try {
    const data = {}
    await storage.set('test', new Date().toString())

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
