import type { CompiledRegistration } from './config'
import { eq, gt, inArray, sql } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { appservices, eventsState, eventsTimeline, roomAliases, roomMembers } from '@/db/schema'
import { formatEvent } from '@/shared/helpers/formatEvent'
import { findInterestedServices, getRegistrations } from './config'

const BATCH_SIZE = 100
const MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

function shouldBackoff(state: { failedAttempts: number, lastFailureAt: Date | null }): boolean {
  if (state.failedAttempts === 0 || !state.lastFailureAt)
    return false
  const backoffMs = Math.min(1000 * (2 ** (state.failedAttempts - 1)), MAX_BACKOFF_MS)
  return Date.now() - state.lastFailureAt.getTime() < backoffMs
}

function getRoomAliasesForRooms(roomIds: string[]): Map<string, string[]> {
  const aliasMap = new Map<string, string[]>()
  if (roomIds.length === 0)
    return aliasMap

  const matchedAliases = db.select().from(roomAliases).where(inArray(roomAliases.roomId, roomIds)).all()
  for (const a of matchedAliases) {
    const existing = aliasMap.get(a.roomId)
    if (existing)
      existing.push(a.alias)
    else aliasMap.set(a.roomId, [a.alias])
  }
  return aliasMap
}

function isAsSenderInRoom(reg: CompiledRegistration, roomId: string): boolean {
  const senderUserId = `@${reg.senderLocalpart}:${serverName}`
  const membership = db.select({ membership: roomMembers.membership })
    .from(roomMembers)
    .where(sql`${roomMembers.roomId} = ${roomId} AND ${roomMembers.userId} = ${senderUserId}`)
    .get()
  return membership?.membership === 'join'
}

export async function processAppServiceTransactions(): Promise<void> {
  const registrations = getRegistrations()
  if (registrations.length === 0)
    return

  for (const reg of registrations) {
    if (!reg.url)
      continue

    const state = db.select().from(appservices).where(eq(appservices.id, reg.id)).get()
    if (!state)
      continue

    if (shouldBackoff(state))
      continue

    try {
      const lastPos = state.lastStreamPosition

      let stateEvents: any[]
      let timelineEvents: any[]

      if (lastPos) {
        stateEvents = db.select().from(eventsState).where(gt(eventsState.id, lastPos)).orderBy(eventsState.id).limit(BATCH_SIZE).all()
        timelineEvents = db.select().from(eventsTimeline).where(gt(eventsTimeline.id, lastPos)).orderBy(eventsTimeline.id).limit(BATCH_SIZE).all()
      }
      else {
        stateEvents = db.select().from(eventsState).orderBy(eventsState.id).limit(BATCH_SIZE).all()
        timelineEvents = db.select().from(eventsTimeline).orderBy(eventsTimeline.id).limit(BATCH_SIZE).all()
      }

      // Merge and sort by ULID (lexicographic = chronological)
      const allEvents = [...stateEvents, ...timelineEvents].sort((a, b) => a.id.localeCompare(b.id)).slice(0, BATCH_SIZE)

      if (allEvents.length === 0)
        continue

      // Batch-lookup room aliases for interest matching
      const roomIds = [...new Set(allEvents.map(e => e.roomId))]
      const roomAliasMap = getRoomAliasesForRooms(roomIds)

      // Filter to events this AS is interested in
      const matchedEvents = allEvents.filter((e) => {
        const aliases = roomAliasMap.get(e.roomId) || []
        const interested = findInterestedServices({
          sender: e.sender,
          roomId: e.roomId,
          stateKey: e.stateKey ?? null,
        }, aliases)

        if (interested.some(r => r.id === reg.id))
          return true

        // Check if AS sender is joined to the room
        return isAsSenderInRoom(reg, e.roomId)
      })

      // Advance stream position regardless of matching
      const newPosition = allEvents[allEvents.length - 1]!.id

      if (matchedEvents.length > 0) {
        const txnId = state.lastTxnId + 1
        const formattedEvents = matchedEvents.map(formatEvent)

        const response = await fetch(`${reg.url}/_matrix/app/v1/transactions/${txnId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${reg.hsToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ events: formattedEvents }),
        })

        if (response.ok) {
          db.update(appservices).set({
            lastStreamPosition: newPosition,
            lastTxnId: txnId,
            failedAttempts: 0,
            lastSuccessAt: new Date(),
          }).where(eq(appservices.id, reg.id)).run()
        }
        else {
          logger.warn('appservice_txn_failed', {
            asId: reg.asId,
            txnId,
            status: response.status,
          })
          db.update(appservices).set({
            failedAttempts: state.failedAttempts + 1,
            lastFailureAt: new Date(),
          }).where(eq(appservices.id, reg.id)).run()
        }
      }
      else {
        // No matched events — still advance position
        db.update(appservices).set({
          lastStreamPosition: newPosition,
        }).where(eq(appservices.id, reg.id)).run()
      }
    }
    catch (err) {
      logger.error('appservice_txn_error', { asId: reg.asId, error: String(err) })
      db.update(appservices).set({
        failedAttempts: state.failedAttempts + 1,
        lastFailureAt: new Date(),
      }).where(eq(appservices.id, reg.id)).run()
    }
  }
}

// --- AS Query APIs ---

export async function queryAppServiceUser(userId: string): Promise<boolean> {
  const registrations = getRegistrations()

  for (const reg of registrations) {
    if (!reg.url)
      continue

    const matches = reg.namespaces.users.some(e => e.regex.test(userId))
    if (!matches)
      continue

    try {
      const response = await fetch(`${reg.url}/_matrix/app/v1/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${reg.hsToken}` },
      })
      if (response.ok)
        return true
    }
    catch {
      // AS unreachable
    }
  }

  return false
}

export async function queryAppServiceRoomAlias(alias: string): Promise<string | null> {
  const registrations = getRegistrations()

  for (const reg of registrations) {
    if (!reg.url)
      continue

    const matches = reg.namespaces.aliases.some(e => e.regex.test(alias))
    if (!matches)
      continue

    try {
      const response = await fetch(`${reg.url}/_matrix/app/v1/rooms/${encodeURIComponent(alias)}`, {
        headers: { Authorization: `Bearer ${reg.hsToken}` },
      })
      if (response.ok) {
        // After AS creates the room, re-query our DB for the alias
        const row = db.select().from(roomAliases).where(eq(roomAliases.alias, alias)).get()
        return row?.roomId ?? null
      }
    }
    catch {
      // AS unreachable
    }
  }

  return null
}
