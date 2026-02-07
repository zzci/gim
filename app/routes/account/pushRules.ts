import { Hono } from 'hono'

export const pushRulesRoute = new Hono()

pushRulesRoute.get('/', async (c) => {
  try {
    const data = {
      global: {
        underride: [
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'm.call.invite',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'sound',
                value: 'ring',
              },
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.m.rule.call',
            default: true,
            enabled: true,
          },
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'm.room.encrypted',
              },
              {
                kind: 'room_member_count',
                is: '2',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'sound',
                value: 'default',
              },
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.m.rule.encrypted_room_one_to_one',
            default: true,
            enabled: true,
          },
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'm.room.message',
              },
              {
                kind: 'room_member_count',
                is: '2',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'sound',
                value: 'default',
              },
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.m.rule.room_one_to_one',
            default: true,
            enabled: true,
          },
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'm.room.message',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.m.rule.message',
            default: true,
            enabled: true,
          },
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'm.room.encrypted',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.m.rule.encrypted',
            default: true,
            enabled: true,
          },
          {
            conditions: [
              {
                kind: 'event_match',
                key: 'type',
                pattern: 'im.vector.modular.widgets',
              },
              {
                kind: 'event_match',
                key: 'content.type',
                pattern: 'jitsi',
              },
              {
                kind: 'event_match',
                key: 'state_key',
                pattern: '*',
              },
            ],
            actions: [
              'notify',
              {
                set_tweak: 'highlight',
                value: false,
              },
            ],
            rule_id: '.im.vector.jitsi',
            default: true,
            enabled: true,
          },
        ],
        sender: [],
        room: [],
        content: [
          {
            actions: [
              'notify',
              {
                set_tweak: 'highlight',
              },
              {
                set_tweak: 'sound',
                value: 'default',
              },
            ],
            rule_id: '.m.rule.contains_user_name',
            default: true,
            pattern: 'roy',
            enabled: true,
          },
        ],
      },
    }
    return c.json(data)
  }
  catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
