import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsState } from '@/db/schema'

export function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

export function getPowerLevelsContent(roomId: string): Record<string, any> {
  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, 'm.room.power_levels'),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow)
    return {}

  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, stateRow.eventId))
    .get()

  return (event?.content as Record<string, any>) ?? {}
}
