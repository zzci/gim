import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Sync Edge Cases', () => {
  test('sync with current token and short timeout returns within ~1s with empty rooms', async () => {
    const a = await getAlice()

    // Get current sync token
    const initial = await a.sync()
    const since = initial.next_batch

    const start = Date.now()
    const res = await a.sync({ since, timeout: 1000 })
    const elapsed = Date.now() - start

    expect(res.next_batch).toBeTruthy()
    // Should return within ~2s (1s timeout + some network overhead)
    expect(elapsed).toBeLessThan(3000)
  })

  test('long-poll sync returns early when new message arrives', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Create shared room
    const room = await a.createRoom({ name: `LongPoll ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob gets sync token
    const initial = await b.sync()
    const since = initial.next_batch

    // Start a 5s timeout sync for bob (runs concurrently)
    const syncPromise = b.sync({ since, timeout: 5000 })

    // Wait a moment then send message from alice
    await new Promise(r => setTimeout(r, 300))
    const msg = await a.sendMessage(room.room_id, txnId('longpoll'), {
      msgtype: 'm.text',
      body: 'wake up bob',
    })

    // Bob's sync should return with the message before the 5s timeout
    const start = Date.now()
    const sync = await syncPromise
    const elapsed = Date.now() - start

    // Should have returned well before the 5s timeout
    // (giving generous margin for CI environments)
    expect(elapsed).toBeLessThan(4500)

    const roomData = sync.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    const found = roomData.timeline.events.find((e: any) => e.event_id === msg.event_id)
    expect(found).toBeDefined()
    expect(found.content.body).toBe('wake up bob')

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('long-poll sync returns early when invite arrives', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Bob gets current sync token
    const initial = await b.sync()
    const since = initial.next_batch

    // Create room first so invite is the only action during long-poll
    const room = await a.createRoom({ name: `InviteRT ${Date.now()}` })

    // Start a 15s timeout sync for Bob (runs concurrently)
    const start = Date.now()
    const syncPromise = b.sync({ since, timeout: 15000 })

    // Wait a moment, then Alice invites Bob
    await new Promise(r => setTimeout(r, 300))
    await a.invite(room.room_id, b.userId)

    // Bob's sync should return with the invite before the 15s timeout
    const sync = await syncPromise
    const elapsed = Date.now() - start

    // Should have returned well before the 15s timeout (within ~3s)
    expect(elapsed).toBeLessThan(5000)

    const inviteRoom = sync.rooms.invite[room.room_id]
    expect(inviteRoom).toBeDefined()
    expect(inviteRoom.invite_state.events.length).toBeGreaterThan(0)

    // Cleanup
    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('initial sync (no since) returns all joined rooms', async () => {
    const a = await getAlice()

    // Create a room so we have at least one
    const room = await a.createRoom({ name: `InitSync ${Date.now()}` })

    const sync = await a.sync()
    expect(sync.next_batch).toBeTruthy()
    expect(sync.rooms).toBeDefined()
    expect(sync.rooms.join).toBeDefined()

    // The room we just created should be in the join section
    expect(sync.rooms.join[room.room_id]).toBeDefined()
    expect(sync.rooms.join[room.room_id].timeline).toBeDefined()
    expect(sync.rooms.join[room.room_id].state).toBeDefined()

    await a.leaveRoom(room.room_id)
  })
})
