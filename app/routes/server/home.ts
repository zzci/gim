import { Hono } from 'hono'
import { serverName, version, poweredBy } from '@/config'

const startTime = new Date()

export const homeRoute = new Hono()

homeRoute.get('/', async (c) => {
  const data = {
    message: 'Yet another matrix server!',
    url: c.req.url,
    serverName,
    version,
    poweredBy,
    startTime,
    currentTime: new Date(),
  }
  return c.json(data)
})
