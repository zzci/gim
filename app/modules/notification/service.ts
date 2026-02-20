import type { MatrixEvent } from '@/modules/message/service'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { pushers, pushNotifications, roomMembers } from '@/db/schema'
import { getDisplayName } from '@/models/account'
import { getJoinedMemberCount } from '@/models/roomMembership'
import { getStateContent, getUserPowerLevel } from '@/models/roomState'
import { sendPushNotification } from '@/modules/notification/pushGateway'

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

async function getNotificationPowerLevel(roomId: string): Promise<number> {
  const content = await getStateContent(roomId, 'm.room.power_levels', '')
  if (!content)
    return 50
  const notifs = content.notifications as Record<string, number> | undefined
  return notifs?.room ?? 50
}

async function matchCondition(condition: PushCondition, event: MatrixEvent, roomId: string, userId: string): Promise<boolean> {
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
      const memberCount = await getJoinedMemberCount(roomId)
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
      const displayname = await getDisplayName(userId)
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
      const requiredLevel = await getNotificationPowerLevel(roomId)
      const senderLevel = await getUserPowerLevel(roomId, event.sender)
      return senderLevel >= requiredLevel
    }

    default:
      return false
  }
}

export async function evaluatePushRules(event: MatrixEvent, roomId: string, userId: string): Promise<unknown[] | null> {
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
      let allMatch = true
      for (const cond of rule.conditions) {
        if (!await matchCondition(cond, event, roomId, userId)) {
          allMatch = false
          break
        }
      }
      if (!allMatch)
        continue
      return rule.actions
    }
  }

  return null
}

export async function recordNotifications(event: MatrixEvent, roomId: string): Promise<void> {
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

    const actions = await evaluatePushRules(event, roomId, member.userId)
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
