import type { AuthEnv } from '@/shared/middleware/auth'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { turnSharedSecret, turnTtl, turnUris } from '@/config'
import { authMiddleware } from '@/shared/middleware/auth'

export const turnServerRoute = new Hono<AuthEnv>()

turnServerRoute.get('/', authMiddleware, (c) => {
  const uris = turnUris ? turnUris.split(',').map(s => s.trim()).filter(Boolean) : []

  if (!uris.length || !turnSharedSecret) {
    return c.json({})
  }

  const { userId } = c.get('auth')
  const expiry = Math.floor(Date.now() / 1000) + turnTtl
  const username = `${expiry}:${userId}`
  const password = createHmac('sha1', turnSharedSecret).update(username).digest('base64')

  return c.json({
    username,
    password,
    uris,
    ttl: turnTtl,
  })
})
