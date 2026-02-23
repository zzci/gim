import { randomBytes } from 'node:crypto'

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer '))
    return null
  return header.slice(7)
}

export type CrossSigningDbType = 'master' | 'self_signing' | 'user_signing'

export const CROSS_SIGNING_KEY_TYPES: CrossSigningDbType[] = ['master', 'self_signing', 'user_signing']

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
  return `{${entries.join(',')}}`
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000

const activeChallenges = new Map<string, { userId: string, expiresAt: number }>()

const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of activeChallenges) {
    if (entry.expiresAt <= now)
      activeChallenges.delete(token)
  }
}, 60_000)
cleanupInterval.unref()

export function createCrossSigningChallenge(userId: string): string {
  const token = randomBytes(32).toString('hex')
  activeChallenges.set(token, {
    userId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  })
  return token
}

export function isCrossSigningResetVerified(
  _authHeader: string | undefined,
  authUserId: string,
  authPayload: Record<string, unknown> | undefined,
): boolean {
  if (!authPayload || typeof authPayload !== 'object')
    return false

  const authType = typeof authPayload.type === 'string' ? authPayload.type : ''
  if (authType !== 'm.login.reauth')
    return false

  const sessionToken = typeof authPayload.session === 'string' ? authPayload.session : ''
  if (!sessionToken)
    return false

  const challenge = activeChallenges.get(sessionToken)
  if (!challenge)
    return false

  if (challenge.expiresAt <= Date.now()) {
    activeChallenges.delete(sessionToken)
    return false
  }

  if (challenge.userId !== authUserId) {
    return false
  }

  activeChallenges.delete(sessionToken)

  const userId = typeof authPayload.user_id === 'string' ? authPayload.user_id : ''
  if (!userId || userId !== authUserId)
    return false

  return true
}
