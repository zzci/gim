import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Notifications', () => {
  test('messages create notifications for other users', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Notif ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    await a.sendMessage(room.room_id, txnId('notif'), {
      msgtype: 'm.text',
      body: 'Hello Bob!',
    })

    const notifs = await b.getNotifications()
    expect(notifs.notifications.length).toBeGreaterThan(0)

    const latest = notifs.notifications[0]
    expect(latest.event).toBeDefined()
    expect(latest.actions).toBeDefined()
    expect(latest.room_id).toBe(room.room_id)
    expect(latest.ts).toBeDefined()

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('sender does not get self-notifications', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `NoSelf ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    await a.sendMessage(room.room_id, txnId('noself'), {
      msgtype: 'm.text',
      body: 'No self-notif',
    })

    const notifs = await a.getNotifications()
    const selfNotifs = notifs.notifications.filter(
      (n: any) => n.event.sender === a.userId && n.room_id === room.room_id,
    )
    expect(selfNotifs.length).toBe(0)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('highlight-only filter returns mentions', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Highlight ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Normal message
    await a.sendMessage(room.room_id, txnId('normal'), {
      msgtype: 'm.text',
      body: 'Normal message',
    })

    // Mention via m.mentions
    const mention = await a.sendMessage(room.room_id, txnId('mention'), {
      'msgtype': 'm.text',
      'body': 'Hey Bob!',
      'm.mentions': { user_ids: [b.userId] },
    })

    const highlights = await b.getNotifications({ only: 'highlight' })
    expect(highlights.notifications.length).toBeGreaterThan(0)

    const mentionNotif = highlights.notifications.find(
      (n: any) => n.event.event_id === mention.event_id,
    )
    expect(mentionNotif).toBeDefined()

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('pagination works with limit and from', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `NotifPage ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Send several messages
    for (let i = 0; i < 5; i++) {
      await a.sendMessage(room.room_id, txnId(`page-${i}`), {
        msgtype: 'm.text',
        body: `Paginated ${i}`,
      })
    }

    const page1 = await b.getNotifications({ limit: 3 })
    expect(page1.notifications.length).toBe(3)
    expect(page1.next_token).toBeDefined()

    const page2 = await b.getNotifications({ from: page1.next_token, limit: 3 })
    expect(page2.notifications.length).toBeGreaterThan(0)

    // Pages should not overlap
    const page1Ids = page1.notifications.map((n: any) => n.event.event_id)
    const page2Ids = page2.notifications.map((n: any) => n.event.event_id)
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id)
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('read receipt marks notifications as read', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `ReadNotif ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const msg = await a.sendMessage(room.room_id, txnId('read'), {
      msgtype: 'm.text',
      body: 'Read me',
    })

    // Before read receipt
    const before = await b.getNotifications()
    const unread = before.notifications.find(
      (n: any) => n.event.event_id === msg.event_id,
    )
    // Might be unread
    expect(unread).toBeDefined()

    // Send read receipt
    await b.sendReceipt(room.room_id, msg.event_id)

    // After read receipt — notification should be read
    const after = await b.getNotifications()
    const readNotif = after.notifications.find(
      (n: any) => n.event.event_id === msg.event_id,
    )
    expect(readNotif).toBeDefined()
    expect(readNotif.read).toBe(true)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})

describe('Push Rules', () => {
  test('GET /pushrules returns default rules', async () => {
    const a = await getAlice()
    const res = await a.request('GET', '/_matrix/client/v3/pushrules/')
    expect(res.global).toBeDefined()
    expect(res.global.override).toBeDefined()
    expect(res.global.underride).toBeDefined()
    expect(res.global.content).toBeDefined()
    expect(res.global.sender).toBeDefined()
    expect(res.global.room).toBeDefined()

    // Check master rule exists
    const master = res.global.override.find((r: any) => r.rule_id === '.m.rule.master')
    expect(master).toBeDefined()
    expect(master.enabled).toBe(false)
  })
})
