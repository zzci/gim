import { eq } from 'drizzle-orm'
import { requireEncryption } from '@/config'
import { db } from '@/db'
import { roomAliases, rooms } from '@/db/schema'
import { getJoinedMemberCount, getMembership } from '@/models/roomMembership'
import { getStateContent } from '@/models/roomState'
import { createEvent } from '@/modules/message/service'
import { generateRoomId } from '@/utils/tokens'

export async function getRoomMembership(roomId: string, userId: string): Promise<string | null> {
  return getMembership(roomId, userId)
}

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

export async function createRoom(opts: CreateRoomOptions): Promise<string> {
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
  await createEvent({
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
  await createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.member',
    stateKey: opts.creatorId,
    content: {
      membership: 'join',
      displayname: opts.creatorId,
    },
  })

  // 3. Power levels (deep-merge users and events from override to preserve creator PL)
  const overrideUsers = (opts.powerLevelContentOverride?.users as Record<string, number>) || {}
  const overrideEvents = (opts.powerLevelContentOverride?.events as Record<string, number>) || {}
  const { users: _u, events: _e, ...overrideRest } = opts.powerLevelContentOverride || {}

  const powerLevels: Record<string, unknown> = {
    users: {
      [opts.creatorId]: 100,
      ...overrideUsers,
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
      ...overrideEvents,
    },
    events_default: 0,
    state_default: 50,
    ban: 50,
    kick: 50,
    redact: 50,
    invite: preset === 'public_chat' ? 0 : 50,
    ...overrideRest,
  }

  await createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.power_levels',
    stateKey: '',
    content: powerLevels,
  })

  // 4. Join rules
  await createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.join_rules',
    stateKey: '',
    content: { join_rule: joinRule },
  })

  // 5. History visibility
  await createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.history_visibility',
    stateKey: '',
    content: { history_visibility: historyVisibility },
  })

  // 6. Guest access
  await createEvent({
    roomId,
    sender: opts.creatorId,
    type: 'm.room.guest_access',
    stateKey: '',
    content: { guest_access: guestAccess },
  })

  // 7. Optional name
  if (opts.name) {
    await createEvent({
      roomId,
      sender: opts.creatorId,
      type: 'm.room.name',
      stateKey: '',
      content: { name: opts.name },
    })
  }

  // 8. Optional topic
  if (opts.topic) {
    await createEvent({
      roomId,
      sender: opts.creatorId,
      type: 'm.room.topic',
      stateKey: '',
      content: { topic: opts.topic },
    })
  }

  // 9. Initial state events (skip types already set by the server)
  const protectedTypes = new Set([
    'm.room.create',
    'm.room.member',
    'm.room.power_levels',
    'm.room.join_rules',
    'm.room.history_visibility',
    'm.room.guest_access',
  ])
  if (opts.initialState) {
    for (const stateEvent of opts.initialState) {
      if (protectedTypes.has(stateEvent.type))
        continue
      await createEvent({
        roomId,
        sender: opts.creatorId,
        type: stateEvent.type,
        stateKey: stateEvent.state_key,
        content: stateEvent.content,
      })
    }
  }

  // 10. Force encryption if not already set by initial_state
  const hasEncryption = opts.initialState?.some(e => e.type === 'm.room.encryption')
  if (requireEncryption && !hasEncryption) {
    await createEvent({
      roomId,
      sender: opts.creatorId,
      type: 'm.room.encryption',
      stateKey: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    })
  }

  // 11. Invite users
  if (opts.invite) {
    for (const userId of opts.invite) {
      await createEvent({
        roomId,
        sender: opts.creatorId,
        type: 'm.room.member',
        stateKey: userId,
        content: {
          membership: 'invite',
          ...(opts.isDirect ? { is_direct: true } : {}),
        },
      })
    }
  }

  logger.info('room_created', { roomId, creatorId: opts.creatorId, preset, inviteCount: opts.invite?.length || 0 })

  return roomId
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

export async function getRoomSummary(roomId: string, userId?: string): Promise<RoomSummary | null> {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return null

  const joinRuleContent = await getStateContent(roomId, 'm.room.join_rules', '')
  const joinRule = (joinRuleContent?.join_rule as string) ?? 'invite'

  const histVis = await getStateContent(roomId, 'm.room.history_visibility')
  const worldReadable = (histVis?.history_visibility as string) === 'world_readable'

  const guestAccessContent = await getStateContent(roomId, 'm.room.guest_access')
  const guestCanJoin = (guestAccessContent?.guest_access as string) === 'can_join'

  // Access control: unauthenticated users can only see public/knock/world-readable rooms
  const membership = userId ? await getMembership(roomId, userId) : null
  const isMember = membership === 'join' || membership === 'invite'
  const isPublicish = joinRule === 'public' || joinRule === 'knock' || worldReadable
  if (!isMember && !isPublicish)
    return null

  const joinedCount = await getJoinedMemberCount(roomId)

  const summary: RoomSummary = {
    room_id: roomId,
    num_joined_members: joinedCount,
    guest_can_join: guestCanJoin,
    world_readable: worldReadable,
    room_version: room.version,
  }

  const nameContent = await getStateContent(roomId, 'm.room.name')
  if (nameContent?.name)
    summary.name = nameContent.name as string

  const avatarContent = await getStateContent(roomId, 'm.room.avatar')
  if (avatarContent?.url)
    summary.avatar_url = avatarContent.url as string

  const topicContent = await getStateContent(roomId, 'm.room.topic')
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

  const createContent = await getStateContent(roomId, 'm.room.create')
  if (createContent?.type)
    summary.room_type = createContent.type as string

  const encContent = await getStateContent(roomId, 'm.room.encryption')
  if (encContent?.algorithm)
    summary.encryption = encContent.algorithm as string

  if (membership)
    summary.membership = membership

  return summary
}
