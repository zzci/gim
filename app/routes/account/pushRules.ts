import { Hono } from 'hono'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const pushRulesRoute = new Hono()

pushRulesRoute.use('/*', authMiddleware)

// Default push rules - these are the Matrix spec defaults
function getDefaultPushRules(userId: string) {
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

// GET /pushrules/ - get all push rules
pushRulesRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  return c.json(getDefaultPushRules(auth.userId))
})

// Catch-all for sub-paths - return empty for now
pushRulesRoute.get('/*', async (c) => {
  return c.json({})
})

pushRulesRoute.put('/*', async (c) => {
  return c.json({})
})

pushRulesRoute.delete('/*', async (c) => {
  return c.json({})
})
