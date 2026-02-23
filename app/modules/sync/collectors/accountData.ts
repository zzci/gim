import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { accountData } from '@/db/schema'
import { isAccountDataAllowedForUnverified } from '@/shared/middleware/deviceTrust'

const BACKUP_DISABLED_TYPE = 'm.org.matrix.custom.backup_disabled'

export interface AccountDataResult {
  events: Array<{ type: string, content: Record<string, unknown> }>
  maxStreamId: string
}

/**
 * Collect global account data for a user.
 * - sinceId = null: returns full dataset (initial sync or trust transition)
 * - Untrusted devices only see whitelisted types
 * - Always injects backup_disabled on initial/trust-transition sync
 */
export function collectGlobalAccountData(
  userId: string,
  isTrusted: boolean,
  sinceId: string | null,
): AccountDataResult {
  let events: Array<{ type: string, content: Record<string, unknown> }> = []
  let maxStreamId = ''

  if (sinceId === null) {
    const allData = db.select().from(accountData).where(and(
      eq(accountData.userId, userId),
      eq(accountData.roomId, ''),
    )).all()
    events = allData
      .filter(d => isTrusted || isAccountDataAllowedForUnverified(d.type))
      .map(d => ({ type: d.type, content: d.content }))
  }
  else {
    const rows = db.select().from(accountData).where(and(
      eq(accountData.userId, userId),
      eq(accountData.roomId, ''),
      gt(accountData.streamId, sinceId),
    )).all()
    const filtered = rows.filter(d => isTrusted || isAccountDataAllowedForUnverified(d.type))
    events = filtered.map(d => ({ type: d.type, content: d.content }))
    if (filtered.length > 0) {
      maxStreamId = filtered.reduce((max, d) => d.streamId > max ? d.streamId : max, '')
    }
  }

  // Always include backup_disabled on initial/trust-transition sync
  if (sinceId === null && !events.some(d => d.type === BACKUP_DISABLED_TYPE)) {
    events.push({ type: BACKUP_DISABLED_TYPE, content: { disabled: true } })
  }

  return { events, maxStreamId }
}
