import { Hono } from 'hono'
import { db } from '@/db'
import { toDeviceMessages } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const sendToDeviceRoute = new Hono()

sendToDeviceRoute.use('/*', authMiddleware)

// PUT /sendToDevice/:eventType/:txnId
sendToDeviceRoute.put('/:eventType/:txnId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const eventType = c.req.param('eventType')
  const body = await c.req.json()
  const messages = body.messages || {}

  // Get next stream ID
  const last = db.select({ id: toDeviceMessages.streamId })
    .from(toDeviceMessages)
    .orderBy(toDeviceMessages.streamId)
    .limit(1)
    .get()
  let nextStreamId = (last?.id ?? 0) + 1

  for (const [userId, deviceMap] of Object.entries(messages) as [string, Record<string, any>][]) {
    for (const [deviceId, content] of Object.entries(deviceMap)) {
      if (deviceId === '*') {
        // Wildcard: send to all devices of user
        // For now, just skip — full implementation would enumerate devices
        continue
      }

      db.insert(toDeviceMessages).values({
        userId,
        deviceId,
        type: eventType,
        content: content || {},
        sender: auth.userId,
        streamId: nextStreamId++,
      }).run()
    }
  }

  return c.json({})
})
