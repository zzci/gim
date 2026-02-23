import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Concurrent Operations', () => {
  test('10 parallel messages to same room all get unique event IDs', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Concurrent Msg ${Date.now()}` })

    const promises = Array.from(
      { length: 10 },
      (_, i) => a.sendMessage(room.room_id, txnId(`concurrent-${i}`), {
        msgtype: 'm.text',
        body: `concurrent message ${i}`,
      }),
    )

    const results = await Promise.all(promises)
    const eventIds = results.map(r => r.event_id)

    // All should have unique event IDs
    expect(eventIds.length).toBe(10)
    const uniqueIds = new Set(eventIds)
    expect(uniqueIds.size).toBe(10)

    // All should start with $
    for (const id of eventIds) {
      expect(id).toMatch(/^\$/)
    }

    await a.leaveRoom(room.room_id)
  })

  test('5 rooms created in parallel all get unique room IDs', async () => {
    const a = await getAlice()

    const promises = Array.from(
      { length: 5 },
      (_, i) => a.createRoom({ name: `Parallel Room ${i} ${Date.now()}` }),
    )

    const results = await Promise.all(promises)
    const roomIds = results.map(r => r.room_id)

    // All should have unique room IDs
    expect(roomIds.length).toBe(5)
    const uniqueIds = new Set(roomIds)
    expect(uniqueIds.size).toBe(5)

    // All should start with !
    for (const id of roomIds) {
      expect(id).toMatch(/^!/)
    }

    // Cleanup
    for (const id of roomIds) {
      await a.leaveRoom(id)
    }
  })

  test('messages sent while bob is syncing are eventually received', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `SyncDuring ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob gets initial sync token
    const initial = await b.sync()
    const since = initial.next_batch

    // Alice sends 5 messages
    const sentIds: string[] = []
    for (let i = 0; i < 5; i++) {
      const res = await a.sendMessage(room.room_id, txnId(`during-${i}`), {
        msgtype: 'm.text',
        body: `during sync ${i}`,
      })
      sentIds.push(res.event_id)
    }

    // Bob syncs and should get all messages
    const sync = await b.sync({ since, timeout: 2000 })
    const roomData = sync.rooms.join[room.room_id]
    expect(roomData).toBeDefined()

    const receivedIds = roomData.timeline.events
      .filter((e: any) => e.type === 'm.room.message')
      .map((e: any) => e.event_id)

    // All sent messages should be received
    for (const id of sentIds) {
      expect(receivedIds).toContain(id)
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
