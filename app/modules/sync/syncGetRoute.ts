import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { touchPresence } from '@/modules/presence/service'
import { getDeviceLastSyncBatch } from '@/modules/sync/collectors/position'
import { longPoll } from '@/modules/sync/longPoll'
import { buildSyncResponse } from '@/modules/sync/service'
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

    if (!since) {
      const lastBatch = getDeviceLastSyncBatch(auth.userId, auth.deviceId)
      if (lastBatch) {
        since = lastBatch
        logger.debug('sync_recovered_since', { userId: auth.userId, deviceId: auth.deviceId, since })
      }
    }

    if (setPresence !== 'offline') {
      touchPresence(auth.userId, 'online')
    }

    const syncOpts = {
      userId: auth.userId,
      deviceId: auth.deviceId,
      isTrustedDevice: auth.trustState === 'trusted',
      since,
      fullState,
      setPresence: setPresence || undefined,
    }

    const response = (since && timeout > 0)
      ? await longPoll({
        userId: auth.userId,
        timeout,
        buildResponse: () => buildSyncResponse(syncOpts),
        hasChanges: r =>
          Object.keys(r.rooms.join).length > 0
          || Object.keys(r.rooms.invite).length > 0
          || Object.keys(r.rooms.leave).length > 0
          || r.to_device.events.length > 0
          || r.device_lists.changed.length > 0,
      })
      : buildSyncResponse(syncOpts)

    return c.json(response)
  }
  catch (err) {
    logger.error('sync_failed', { userId: auth.userId, deviceId: auth.deviceId, error: err instanceof Error ? err.message : err })
    return c.json({ errcode: 'M_UNKNOWN', error: 'Internal sync error' }, 500)
  }
})
