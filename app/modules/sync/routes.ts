import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { touchPresence } from '@/modules/presence/service'
import { waitForNotification } from '@/modules/sync/notifier'
import { buildSyncResponse, getDeviceLastSyncBatch } from '@/modules/sync/service'
import { authMiddleware } from '@/shared/middleware/auth'

export const syncRoute = new Hono<AuthEnv>()

syncRoute.use('/*', authMiddleware)

syncRoute.get('/', async (c) => {
  const auth = c.get('auth')
  try {
    let since = c.req.query('since') || undefined
    const timeout = Math.min(Number.parseInt(c.req.query('timeout') || '0'), 30000)
    const fullState = c.req.query('full_state') === 'true'
    const setPresence = c.req.query('set_presence')

    // If no since token, try to recover from device's last sync batch
    if (!since) {
      const lastBatch = getDeviceLastSyncBatch(auth.userId, auth.deviceId)
      if (lastBatch) {
        since = lastBatch
        logger.debug('sync_recovered_since', { userId: auth.userId, deviceId: auth.deviceId, since })
      }
    }

    // Update presence unless client opts out
    if (setPresence !== 'offline') {
      touchPresence(auth.userId, 'online')
    }

    const syncOpts = {
      userId: auth.userId,
      deviceId: auth.deviceId,
      since,
      fullState,
      setPresence: setPresence || undefined,
    }

    // Build initial response
    let response = buildSyncResponse(syncOpts)

    // If incremental sync has no changes and timeout > 0, wait for notification
    if (since && timeout > 0) {
      const hasChanges = Object.keys(response.rooms.join).length > 0
        || Object.keys(response.rooms.invite).length > 0
        || Object.keys(response.rooms.leave).length > 0
        || response.to_device.events.length > 0
        || response.device_lists.changed.length > 0

      if (!hasChanges) {
        const notified = await waitForNotification(auth.userId, timeout)
        if (notified) {
          response = buildSyncResponse(syncOpts)
        }
      }
    }

    c.header('Connection', 'close')
    return c.json(response)
  }
  catch (err) {
    logger.error('sync_failed', { userId: auth.userId, deviceId: auth.deviceId, error: err instanceof Error ? err.message : err })
    return c.json({ errcode: 'M_UNKNOWN', error: 'Internal sync error' }, 500)
  }
})
