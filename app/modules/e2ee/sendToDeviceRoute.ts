import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeToDeviceMessages } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'

export const sendToDeviceRoute = new Hono<AuthEnv>()
sendToDeviceRoute.use('/*', authMiddleware)

sendToDeviceRoute.put('/:eventType/:txnId', async (c) => {
  const auth = c.get('auth')
  const eventType = c.req.param('eventType')
  const body = await c.req.json()
  const messages = body.messages || {}

  const notifiedUsers = new Set<string>()

  for (const [userId, deviceMap] of Object.entries(messages) as [string, Record<string, any>][]) {
    for (const [deviceId, content] of Object.entries(deviceMap)) {
      if (deviceId === '*') {
        const userDevices = db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).all()

        for (const d of userDevices) {
          db.insert(e2eeToDeviceMessages).values({
            userId,
            deviceId: d.id,
            type: eventType,
            content: content || {},
            sender: auth.userId,
          }).run()
        }
        notifiedUsers.add(userId)
        continue
      }

      db.insert(e2eeToDeviceMessages).values({
        userId,
        deviceId,
        type: eventType,
        content: content || {},
        sender: auth.userId,
      }).run()
      notifiedUsers.add(userId)
    }
  }

  for (const userId of notifiedUsers) {
    notifyUser(userId)
  }

  return c.json({})
})
