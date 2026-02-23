import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Sync', () => {
  test('initial sync returns next_batch and room structure', async () => {
    const a = await getAlice()
    const res = await a.sync()

    expect(res.next_batch).toBeTruthy()
    expect(res.rooms).toBeDefined()
    expect(res.rooms.join).toBeDefined()
    expect(res.rooms.invite).toBeDefined()
    expect(res.rooms.leave).toBeDefined()
    expect(res.account_data).toBeDefined()
    expect(res.to_device).toBeDefined()
    expect(res.device_lists).toBeDefined()
  })

  test('incremental sync picks up new messages', async () => {
    const a = await getAlice()

    // Get initial sync token
    const initial = await a.sync()
    const since = initial.next_batch

    // Create room and send a message
    const room = await a.createRoom({ name: `Sync Test ${Date.now()}` })
    const msg = await a.sendMessage(room.room_id, txnId('sync'), {
      msgtype: 'm.text',
      body: 'sync test message',
    })

    // Incremental sync should contain the new room + message
    const inc = await a.sync({ since })
    expect(inc.next_batch).not.toBe(since)

    const roomData = inc.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.timeline.events.length).toBeGreaterThan(0)

    const found = roomData.timeline.events.find((e: any) => e.event_id === msg.event_id)
    expect(found).toBeDefined()
    expect(found.content.body).toBe('sync test message')

    await a.leaveRoom(room.room_id)
  })

  test('sync includes unread notification counts', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Unread Test ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob does initial sync
    const bobSync = await b.sync()
    const since = bobSync.next_batch

    // Alice sends a message
    await a.sendMessage(room.room_id, txnId('unread'), {
      msgtype: 'm.text',
      body: 'unread test',
    })

    // Bob does incremental sync — should have notification count
    const inc = await b.sync({ since })
    const roomData = inc.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.unread_notifications.notification_count).toBeGreaterThanOrEqual(1)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('sync includes room summary with heroes and member counts', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Summary Test ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const res = await a.sync()
    const roomData = res.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.summary['m.joined_member_count']).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('sync includes invite rooms for invited user', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Invite Sync ${Date.now()}`, invite: [b.userId] })

    const bobSync = await b.sync()
    const inviteRoom = bobSync.rooms.invite[room.room_id]
    expect(inviteRoom).toBeDefined()
    expect(inviteRoom.invite_state.events.length).toBeGreaterThan(0)

    // Cleanup
    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
