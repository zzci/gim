import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsState, roomAliases, roomMembers, rooms } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { generateRoomId } from '@/utils/tokens'

export interface CreateRoomOptions {
  creatorId: string
  name?: string
  topic?: string
  roomAliasName?: string
  visibility?: 'public' | 'private'
  preset?: 'private_chat' | 'trusted_private_chat' | 'public_chat'
  isDirect?: boolean
  invite?: string[]
  initialState?: Array<{
    type: string
    state_key: string
    content: Record<string, unknown>
  }>
  powerLevelContentOverride?: Record<string, unknown>
}

export function createRoom(opts: CreateRoomOptions): string {
  // Generate a unique room ID with collision retry
  let roomId = generateRoomId()
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get()
    if (!existing)
      break
    roomId = generateRoomId()
  }

  const preset = opts.preset || (opts.visibility === 'public' ? 'public_chat' : 'private_chat')

  // Determine defaults based on preset
  const joinRule = preset === 'public_chat' ? 'public' : 'invite'
  const historyVisibility = preset === 'public_chat' ? 'shared' : 'shared'
  const guestAccess = preset === 'public_chat' ? 'can_join' : 'forbidden'

  // Insert room record
  db.insert(rooms).values({
    id: roomId,
    creatorId: opts.creatorId,
    isDirect: opts.isDirect || false,
  }).run()

  // 1. m.room.create
  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.create',
    stateKey: '',
    content: {
      creator: opts.creatorId,
      room_version: '12',
    },
  })

  // 2. Creator joins
  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.member',
    stateKey: opts.creatorId,
    content: {
      membership: 'join',
      displayname: opts.creatorId,
    },
  })

  // 3. Power levels
  const powerLevels: Record<string, unknown> = {
    users: {
      [opts.creatorId]: preset === 'trusted_private_chat' ? 100 : 100,
    },
    users_default: preset === 'trusted_private_chat' ? 100 : 0,
    events: {
      'm.room.name': 50,
      'm.room.power_levels': 100,
      'm.room.history_visibility': 100,
      'm.room.canonical_alias': 50,
      'm.room.avatar': 50,
      'm.room.tombstone': 100,
      'm.room.server_acl': 100,
      'm.room.encryption': 100,
    },
    events_default: 0,
    state_default: 50,
    ban: 50,
    kick: 50,
    redact: 50,
    invite: preset === 'public_chat' ? 0 : 50,
    ...opts.powerLevelContentOverride,
  }

  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.power_levels',
    stateKey: '',
    content: powerLevels,
  })

  // 4. Join rules
  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.join_rules',
    stateKey: '',
    content: { join_rule: joinRule },
  })

  // 5. History visibility
  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.history_visibility',
    stateKey: '',
    content: { history_visibility: historyVisibility },
  })

  // 6. Guest access
  createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.guest_access',
    stateKey: '',
    content: { guest_access: guestAccess },
  })

  // 7. Optional name
  if (opts.name) {
    createEvent({
      roomId,
      sender: opts.creatorId,
      type: 'm.room.name',
      stateKey: '',
      content: { name: opts.name },
    })
  }

  // 8. Optional topic
  if (opts.topic) {
    createEvent({
      roomId,
      sender: opts.creatorId,
      type: 'm.room.topic',
      stateKey: '',
      content: { topic: opts.topic },
    })
  }

  // 9. Initial state events
  if (opts.initialState) {
    for (const stateEvent of opts.initialState) {
      createEvent({
        roomId,
        sender: opts.creatorId,
        type: stateEvent.type,
        stateKey: stateEvent.state_key,
        content: stateEvent.content,
      })
    }
  }

  // 10. Invite users
  if (opts.invite) {
    for (const userId of opts.invite) {
      createEvent({
        roomId,
        sender: opts.creatorId,
        type: 'm.room.member',
        stateKey: userId,
        content: {
          membership: 'invite',
        },
      })
    }
  }

  logger.info('room_created', { roomId, creatorId: opts.creatorId, preset, inviteCount: opts.invite?.length || 0 })

  return roomId
}

// Check user power level in a room
export function getUserPowerLevel(roomId: string, userId: string): number {
  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, 'm.room.power_levels'),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow)
    return 0

  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, stateRow.eventId))
    .get()

  if (!event)
    return 0

  const content = event.content as Record<string, unknown>
  const usersMap = content.users as Record<string, number> | undefined
  if (usersMap && userId in usersMap) {
    return usersMap[userId]!
  }
  return (content.users_default as number) ?? 0
}

// Check if a user is a member of a room
export function getRoomMembership(roomId: string, userId: string): string | null {
  const member = db.select({ membership: roomMembers.membership })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.userId, userId),
    ))
    .get()

  return member?.membership ?? null
}

// Get join rule for a room
export function getRoomJoinRule(roomId: string): string {
  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, 'm.room.join_rules'),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow)
    return 'invite'

  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, stateRow.eventId))
    .get()

  return ((event?.content as any)?.join_rule as string) ?? 'invite'
}

// Helper to read a single state event's content for a room
function getRoomStateContent(roomId: string, type: string, stateKey = ''): Record<string, unknown> | null {
  const row = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, type),
      eq(currentRoomState.stateKey, stateKey),
    ))
    .get()
  if (!row)
    return null
  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, row.eventId))
    .get()
  return (event?.content as Record<string, unknown>) ?? null
}

export interface RoomSummary {
  room_id: string
  num_joined_members: number
  guest_can_join: boolean
  world_readable: boolean
  name?: string
  avatar_url?: string
  topic?: string
  join_rule?: string
  canonical_alias?: string
  room_type?: string
  encryption?: string
  membership?: string
  room_version?: string
}

export function getRoomSummary(roomId: string, userId?: string): RoomSummary | null {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return null

  const joinRule = getRoomJoinRule(roomId)

  const histVis = getRoomStateContent(roomId, 'm.room.history_visibility')
  const worldReadable = (histVis?.history_visibility as string) === 'world_readable'

  const guestAccess = getRoomStateContent(roomId, 'm.room.guest_access')
  const guestCanJoin = (guestAccess?.guest_access as string) === 'can_join'

  // Access control: unauthenticated users can only see public/knock/world-readable rooms
  const membership = userId ? getRoomMembership(roomId, userId) : null
  const isMember = membership === 'join' || membership === 'invite'
  const isPublicish = joinRule === 'public' || joinRule === 'knock' || worldReadable
  if (!isMember && !isPublicish)
    return null

  const joinedCount = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.membership, 'join')))
    .all()
    .length

  const summary: RoomSummary = {
    room_id: roomId,
    num_joined_members: joinedCount,
    guest_can_join: guestCanJoin,
    world_readable: worldReadable,
    room_version: room.version,
  }

  const nameContent = getRoomStateContent(roomId, 'm.room.name')
  if (nameContent?.name)
    summary.name = nameContent.name as string

  const avatarContent = getRoomStateContent(roomId, 'm.room.avatar')
  if (avatarContent?.url)
    summary.avatar_url = avatarContent.url as string

  const topicContent = getRoomStateContent(roomId, 'm.room.topic')
  if (topicContent?.topic)
    summary.topic = topicContent.topic as string

  summary.join_rule = joinRule

  const alias = db.select({ alias: roomAliases.alias })
    .from(roomAliases)
    .where(eq(roomAliases.roomId, roomId))
    .limit(1)
    .get()
  if (alias)
    summary.canonical_alias = alias.alias

  const createContent = getRoomStateContent(roomId, 'm.room.create')
  if (createContent?.type)
    summary.room_type = createContent.type as string

  const encContent = getRoomStateContent(roomId, 'm.room.encryption')
  if (encContent?.algorithm)
    summary.encryption = encContent.algorithm as string

  if (membership)
    summary.membership = membership

  return summary
}
