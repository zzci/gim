import { Hono } from 'hono'

export const emptyRoute = new Hono()

emptyRoute.get('/*', async (c) => {
  return c.json({})
})

emptyRoute.put('/*', async (c) => {
  return c.json({})
})

emptyRoute.post('/*', async (c) => {
  return c.json({})
})
