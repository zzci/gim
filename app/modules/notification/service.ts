import type { MatrixEvent } from '@/modules/message/service'
import { and, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, currentRoomState, eventsState, pushers, pushNotifications, roomMembers } from '@/db/schema'
import { sendPushNotification } from '@/modules/notification/pushGateway'
import { TtlCache } from '@/utils/ttlCache'

interface PushRule {
  rule_id: string
  default: boolean
  enabled: boolean
  conditions?: PushCondition[]
  actions: unknown[]
  pattern?: string
}

interface PushCondition {
  kind: string
  key?: string
  pattern?: string
  value?: unknown
  is?: string
}

// Caches for hot data queried repeatedly during push rule evaluation
const memberCountCache = new TtlCache<number>(60_000) // TTL 1min
const powerLevelCache = new TtlCache<Record<string, unknown>>(60_000) // TTL 1min
const displayNameCache = new TtlCache<string | null>(300_000) // TTL 5min

/** Invalidate power level cache for a room (call on m.room.power_levels change) */
export function invalidatePowerLevelCache(roomId: string) {
  powerLevelCache.invalidatePrefix(`pl:${roomId}`)
}

/** Invalidate member count cache for a room (call on membership change) */
export function invalidateMemberCountCache(roomId: string) {
  memberCountCache.invalidate(`mc:${roomId}`)
}

export function getDefaultPushRules(userId: string) {
  const localpart = userId.split(':')[0]?.slice(1) || ''

  return {
    global: {
      override: [
        {
          rule_id: '.m.rule.master',
          default: true,
          enabled: false,
          conditions: [],
          actions: [],
        },
        {
          rule_id: '.m.rule.suppress_notices',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'content.msgtype', pattern: 'm.notice' },
          ],
          actions: [],
        },
        {
          rule_id: '.m.rule.invite_for_me',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.member' },
            { kind: 'event_match', key: 'content.membership', pattern: 'invite' },
            { kind: 'event_match', key: 'state_key', pattern: userId },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'default' },
            { set_tweak: 'highlight', value: false },
          ],
        },
        {
          rule_id: '.m.rule.member_event',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.member' },
          ],
          actions: [],
        },
        {
          rule_id: '.m.rule.is_room_mention',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'content.m\\.mentions.room', pattern: 'true' },
            { kind: 'sender_notification_permission', key: 'room' },
          ],
          actions: [
            'notify',
            { set_tweak: 'highlight' },
          ],
        },
        {
          rule_id: '.m.rule.is_user_mention',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_property_contains', key: 'content.m\\.mentions.user_ids', value: userId },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'default' },
            { set_tweak: 'highlight' },
          ],
        },
        {
          rule_id: '.m.rule.contains_display_name',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'contains_display_name' },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'default' },
            { set_tweak: 'highlight' },
          ],
        },
        {
          rule_id: '.m.rule.tombstone',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.tombstone' },
            { kind: 'event_match', key: 'state_key', pattern: '' },
          ],
          actions: [
            'notify',
            { set_tweak: 'highlight' },
          ],
        },
        {
          rule_id: '.m.rule.roomnotif',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'content.body', pattern: '@room' },
            { kind: 'sender_notification_permission', key: 'room' },
          ],
          actions: [
            'notify',
            { set_tweak: 'highlight' },
          ],
        },
      ],
      underride: [
        {
          rule_id: '.m.rule.call',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.call.invite' },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'ring' },
            { set_tweak: 'highlight', value: false },
          ],
        },
        {
          rule_id: '.m.rule.encrypted_room_one_to_one',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.encrypted' },
            { kind: 'room_member_count', is: '2' },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'default' },
            { set_tweak: 'highlight', value: false },
          ],
        },
        {
          rule_id: '.m.rule.room_one_to_one',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.message' },
            { kind: 'room_member_count', is: '2' },
          ],
          actions: [
            'notify',
            { set_tweak: 'sound', value: 'default' },
            { set_tweak: 'highlight', value: false },
          ],
        },
        {
          rule_id: '.m.rule.message',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.message' },
          ],
          actions: [
            'notify',
            { set_tweak: 'highlight', value: false },
          ],
        },
        {
          rule_id: '.m.rule.encrypted',
          default: true,
          enabled: true,
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.room.encrypted' },
          ],
          actions: [
            'notify',
            { set_tweak: 'highlight', value: false },
          ],
        },
      ],
      sender: [],
      room: [],
      content: [
        {
          rule_id: '.m.rule.contains_user_name',
          default: true,
          enabled: true,
          pattern: localpart,
          actions: [
            'notify',
            { set_tweak: 'highlight' },
            { set_tweak: 'sound', value: 'default' },
          ],
        },
      ],
    },
  }
}

// Resolve a dotted key path on a Matrix event object
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  // Handle escaped dots in key path: `content.m\.mentions.user_ids` → ['content', 'm.mentions', 'user_ids']
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < key.length; i++) {
    if (key[i] === '\\' && i + 1 < key.length && key[i + 1] === '.') {
      current += '.'
      i++ // skip next dot
    }
    else if (key[i] === '.') {
      parts.push(current)
      current = ''
    }
    else {
      current += key[i]
    }
  }
  parts.push(current)

  let value: unknown = obj
  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== 'object')
      return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

// Convert a Matrix push rule glob pattern to a regex
function globToRegex(pattern: string): RegExp {
  let regex = ''
  for (const ch of pattern) {
    if (ch === '*')
      regex += '.*'
    else if (ch === '?')
      regex += '.'
    else
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${regex}$`, 'i')
}

function getRoomMemberCount(roomId: string): number {
  const cached = memberCountCache.get(`mc:${roomId}`)
  if (cached !== undefined)
    return cached

  const result = db.select({ cnt: count() })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .get()
  const cnt = result?.cnt ?? 0
  memberCountCache.set(`mc:${roomId}`, cnt)
  return cnt
}

function getUserDisplayName(userId: string): string | null {
  const cached = displayNameCache.get(`dn:${userId}`)
  if (cached !== undefined)
    return cached

  const account = db.select({ displayname: accounts.displayname })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()
  const name = account?.displayname ?? null
  displayNameCache.set(`dn:${userId}`, name)
  return name
}

/** Get the power level content for a room, with caching */
function getPowerLevelContent(roomId: string): Record<string, unknown> | null {
  const cached = powerLevelCache.get(`pl:${roomId}`)
  if (cached !== undefined)
    return cached

  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, 'm.room.power_levels'),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow) {
    powerLevelCache.set(`pl:${roomId}`, null as any)
    return null
  }

  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, stateRow.eventId))
    .get()

  const content = (event?.content as Record<string, unknown>) ?? null
  if (content)
    powerLevelCache.set(`pl:${roomId}`, content)
  return content
}

function getNotificationPowerLevel(roomId: string): number {
  const content = getPowerLevelContent(roomId)
  if (!content)
    return 50
  const notifs = content.notifications as Record<string, number> | undefined
  return notifs?.room ?? 50
}

function getCachedUserPowerLevel(roomId: string, userId: string): number {
  const content = getPowerLevelContent(roomId)
  if (!content)
    return 0
  const usersMap = content.users as Record<string, number> | undefined
  if (usersMap && userId in usersMap) {
    return usersMap[userId]!
  }
  return (content.users_default as number) ?? 0
}

function matchCondition(condition: PushCondition, event: MatrixEvent, roomId: string, userId: string): boolean {
  switch (condition.kind) {
    case 'event_match': {
      if (!condition.key || condition.pattern === undefined)
        return false
      const value = getNestedValue(event as unknown as Record<string, unknown>, condition.key)
      if (value === undefined || value === null)
        return false
      const regex = globToRegex(condition.pattern!)
      return regex.test(String(value))
    }

    case 'room_member_count': {
      if (!condition.is)
        return false
      const memberCount = getRoomMemberCount(roomId)
      const match = condition.is.match(/^(==|<|<=|>|>=)?(\d+)$/)
      if (!match)
        return false
      const op = match[1] || '=='
      const target = Number.parseInt(match[2]!, 10)
      switch (op) {
        case '==': return memberCount === target
        case '<': return memberCount < target
        case '<=': return memberCount <= target
        case '>': return memberCount > target
        case '>=': return memberCount >= target
        default: return false
      }
    }

    case 'contains_display_name': {
      const displayname = getUserDisplayName(userId)
      if (!displayname)
        return false
      const body = (event.content as Record<string, unknown>).body
      if (typeof body !== 'string')
        return false
      return body.toLowerCase().includes(displayname.toLowerCase())
    }

    case 'event_property_contains': {
      if (!condition.key)
        return false
      const arr = getNestedValue(event as unknown as Record<string, unknown>, condition.key)
      if (!Array.isArray(arr))
        return false
      return arr.includes(condition.value)
    }

    case 'sender_notification_permission': {
      const requiredLevel = getNotificationPowerLevel(roomId)
      const senderLevel = getCachedUserPowerLevel(roomId, event.sender)
      return senderLevel >= requiredLevel
    }

    default:
      return false
  }
}

export function evaluatePushRules(event: MatrixEvent, roomId: string, userId: string): unknown[] | null {
  // Never notify yourself
  if (event.sender === userId)
    return null

  const rules = getDefaultPushRules(userId)
  const allRulesByPriority: PushRule[] = [
    ...rules.global.override,
    ...rules.global.content,
    ...rules.global.room,
    ...rules.global.sender,
    ...rules.global.underride,
  ]

  for (const rule of allRulesByPriority) {
    if (!rule.enabled)
      continue

    // Content rules use pattern matching on content.body
    if (rule.pattern !== undefined) {
      const body = (event.content as Record<string, unknown>).body
      if (typeof body !== 'string')
        continue
      const regex = globToRegex(rule.pattern)
      if (!regex.test(body))
        continue
      return rule.actions
    }

    // Condition-based rules
    if (rule.conditions) {
      const allMatch = rule.conditions.every(c => matchCondition(c, event, roomId, userId))
      if (!allMatch)
        continue
      return rule.actions
    }
  }

  return null
}

export function recordNotifications(event: MatrixEvent, roomId: string): void {
  const members = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()

  const rows: Array<{
    userId: string
    roomId: string
    eventId: string
    actions: unknown[]
    ts: number
  }> = []

  for (const member of members) {
    if (member.userId === event.sender)
      continue

    const actions = evaluatePushRules(event, roomId, member.userId)
    if (!actions || !actions.includes('notify'))
      continue

    rows.push({
      userId: member.userId,
      roomId,
      eventId: event.event_id,
      actions,
      ts: event.origin_server_ts,
    })
  }

  if (rows.length > 0) {
    db.insert(pushNotifications).values(rows).run()

    // Fire-and-forget push notifications to registered pushers
    const notifiedUserIds = [...new Set(rows.map(r => r.userId))]
    for (const userId of notifiedUserIds) {
      const userPushers = db.select().from(pushers).where(and(eq(pushers.userId, userId), eq(pushers.enabled, true))).all()

      for (const pusher of userPushers) {
        sendPushNotification(pusher, {
          event_id: event.event_id,
          room_id: roomId,
          type: event.type,
          sender: event.sender,
          content: event.content,
          prio: 'high',
          devices: [{
            app_id: pusher.appId,
            pushkey: pusher.pushkey,
            data: pusher.data as Record<string, unknown>,
          }],
        }).catch(err => logger.error('push_failed', { error: err instanceof Error ? err.message : String(err) }))
      }
    }
  }
}
