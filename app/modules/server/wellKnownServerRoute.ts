import { Hono } from 'hono'
import { serverName } from '@/config'

export const wellKnowServerRoute = new Hono()

wellKnowServerRoute.get('/', async (c) => {
  return c.json({
    'm.server': `${serverName}:443`,
  })
})
