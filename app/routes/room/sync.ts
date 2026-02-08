import { Hono } from 'hono'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { buildSyncResponse } from '@/services/sync'
import { getMaxStreamOrder } from '@/services/events'

export const syncRoute = new Hono()

syncRoute.use('/*', authMiddleware)

syncRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const since = c.req.query('since')
  const timeout = Math.min(Number.parseInt(c.req.query('timeout') || '0'), 30000)
  const fullState = c.req.query('full_state') === 'true'
  const setPresence = c.req.query('set_presence')

  // Build initial response
  let response = buildSyncResponse({
    userId: auth.userId,
    deviceId: auth.deviceId,
    since: since || undefined,
    fullState,
    setPresence: setPresence || undefined,
  })

  // If incremental sync has no changes and timeout > 0, long-poll
  if (since && timeout > 0) {
    const hasChanges = Object.keys(response.rooms.join).length > 0
      || Object.keys(response.rooms.invite).length > 0
      || Object.keys(response.rooms.leave).length > 0
      || response.to_device.events.length > 0

    if (!hasChanges) {
      const startTime = Date.now()
      const pollInterval = 1000

      while (Date.now() - startTime < timeout) {
        const currentMax = getMaxStreamOrder()
        const sinceOrder = Number.parseInt(since)
        if (currentMax > sinceOrder) {
          response = buildSyncResponse({
            userId: auth.userId,
            deviceId: auth.deviceId,
            since,
            fullState,
            setPresence: setPresence || undefined,
          })
          break
        }
        await sleep(pollInterval)
      }
    }
  }

  return c.json(response)
})
