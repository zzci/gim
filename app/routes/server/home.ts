import { Hono } from 'hono'
import { getStorage } from '@/utils/storage'
import { serverName, version, poweredBy } from '@/config'

export const homeRoute = new Hono()

homeRoute.get('/', async (c) => {
  const startTime = await getStorage('server', 'startTime')

  const data = {
    message: 'Yet another matrix server!',
    url: c.req.url,
    serverName,
    version,
    poweredBy,
    startTime,
    currectTime: new Date(),
  }
  return c.json(data)
})
