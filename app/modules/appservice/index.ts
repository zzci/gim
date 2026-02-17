import { Hono } from 'hono'
import { matrixError, matrixNotFound } from '@/shared/middleware/errors'
import { getRegistrationByAsId, getRegistrationByAsToken } from './config'

export const appServicePingRoute = new Hono()

// POST /:appserviceId/ping
appServicePingRoute.post('/:appserviceId/ping', async (c) => {
  const appserviceId = c.req.param('appserviceId')

  // Validate AS token from Authorization header
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return matrixError(c, 'M_MISSING_TOKEN', 'Missing access token')
  }

  const asReg = getRegistrationByAsToken(token)
  if (!asReg) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown AS token')
  }

  const targetReg = getRegistrationByAsId(appserviceId)
  if (!targetReg) {
    return matrixNotFound(c, 'Appservice not found')
  }

  if (asReg.asId !== targetReg.asId) {
    return matrixError(c, 'M_FORBIDDEN', 'Token does not match appservice')
  }

  if (!targetReg.url) {
    return matrixError(c, 'M_UNKNOWN', 'Appservice has no URL configured')
  }

  let body: Record<string, unknown> = {}
  try {
    body = await c.req.json()
  }
  catch {
    // No body is fine
  }

  const transactionId = body.transaction_id ?? null

  const start = Date.now()
  try {
    const response = await fetch(`${targetReg.url}/_matrix/app/v1/ping`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${targetReg.hsToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transaction_id: transactionId }),
    })

    const durationMs = Date.now() - start

    if (!response.ok) {
      return matrixError(c, 'M_UNKNOWN', `Appservice returned status ${response.status}`)
    }

    return c.json({ duration_ms: durationMs })
  }
  catch (err) {
    return matrixError(c, 'M_UNKNOWN', `Failed to reach appservice: ${String(err)}`)
  }
})
