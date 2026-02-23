// In-memory verification session tracking with 10-minute timeout per Matrix spec.

interface VerificationSession {
  startedAt: number
  fromUser: string
  toUser: string
}

const TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

const sessions = new Map<string, VerificationSession>()

// Cleanup stale sessions every 60 seconds
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [txnId, session] of sessions) {
    if (now - session.startedAt > TIMEOUT_MS)
      sessions.delete(txnId)
  }
}, 60_000)
cleanupTimer.unref()

export function trackVerificationRequest(txnId: string, fromUser: string, toUser: string) {
  sessions.set(txnId, { startedAt: Date.now(), fromUser, toUser })
}

export function isVerificationExpired(txnId: string): boolean {
  const session = sessions.get(txnId)
  if (!session)
    return false // unknown session — allow (may be a different flow or already cleared)
  return Date.now() - session.startedAt > TIMEOUT_MS
}

export function clearVerificationSession(txnId: string) {
  sessions.delete(txnId)
}
