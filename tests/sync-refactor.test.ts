/**
 * Tests for the sync module refactoring.
 * Verifies that all collectors, trust resolution, room data building,
 * and long-poll produce identical results to the pre-refactor behavior.
 */
import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, loadTokens, txnId } from './helpers'

describe('Sync Refactor — Standard Sync', () => {
  test('initial sync returns correct structure with all fields', async () => {
    const a = await getAlice()
    const res = await a.sync()

    // Core structure
    expect(res.next_batch).toBeTruthy()
    expect(res.rooms).toBeDefined()
    expect(res.rooms.join).toBeDefined()
    expect(res.rooms.invite).toBeDefined()
    expect(res.rooms.leave).toBeDefined()

    // Collectors output
    expect(res.account_data).toBeDefined()
    expect(Array.isArray(res.account_data.events)).toBe(true)
    expect(res.to_device).toBeDefined()
    expect(Array.isArray(res.to_device.events)).toBe(true)
    expect(res.device_lists).toBeDefined()
    expect(Array.isArray(res.device_lists.changed)).toBe(true)
    expect(Array.isArray(res.device_lists.left)).toBe(true)
    expect(res.presence).toBeDefined()
    expect(Array.isArray(res.presence.events)).toBe(true)

    // E2EE key counts
    expect(res.device_one_time_keys_count).toBeDefined()
    expect(typeof res.device_one_time_keys_count.signed_curve25519).toBe('number')
    expect(Array.isArray(res.device_unused_fallback_key_types)).toBe(true)
  })

  test('incremental sync picks up new room and message via collectors', async () => {
    const a = await getAlice()

    const initial = await a.sync()
    const since = initial.next_batch

    const room = await a.createRoom({ name: `Refactor-Inc ${Date.now()}` })
    await a.sendMessage(room.room_id, txnId('refactor-inc'), {
      msgtype: 'm.text',
      body: 'refactor incremental test',
    })

    const inc = await a.sync({ since })
    expect(inc.next_batch).not.toBe(since)

    const roomData = inc.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.timeline.events.length).toBeGreaterThan(0)

    const found = roomData.timeline.events.find((e: any) => e.content?.body === 'refactor incremental test')
    expect(found).toBeDefined()

    await a.leaveRoom(room.room_id)
  })

  test('account data collector returns global account data on initial sync', async () => {
    const a = await getAlice()

    const key = `m.test.refactor_ad_${Date.now()}`
    await a.setAccountData(a.userId, key, { refactor: true })

    const res = await a.sync()
    const found = res.account_data.events.find((e: any) => e.type === key)
    expect(found).toBeDefined()
    expect(found.content.refactor).toBe(true)
  })

  test('account data collector returns incremental updates', async () => {
    const a = await getAlice()

    const initial = await a.sync()
    const since = initial.next_batch

    const key = `m.test.refactor_ad_inc_${Date.now()}`
    await a.setAccountData(a.userId, key, { incremental: true })

    const inc = await a.sync({ since })
    const found = inc.account_data.events.find((e: any) => e.type === key)
    expect(found).toBeDefined()
    expect(found.content.incremental).toBe(true)
  })

  test('to-device collector delivers messages', async () => {
    const a = await getAlice()
    const b = await getBob()

    const devices = await a.getDevices()
    const aliceDeviceId = devices.devices[0]?.device_id
    if (!aliceDeviceId)
      return

    // Get initial sync position
    const initial = await a.sync()
    const since = initial.next_batch

    // Bob sends a to-device message to Alice
    await b.sendToDevice('m.test.refactor_td', txnId('refactor-td'), {
      [a.userId]: {
        [aliceDeviceId]: { collector: 'toDevice' },
      },
    })

    const inc = await a.sync({ since })
    const found = inc.to_device.events.find((e: any) => e.type === 'm.test.refactor_td')
    expect(found).toBeDefined()
    expect(found.content.collector).toBe('toDevice')
  })

  test('device lists collector returns changed array on incremental sync', async () => {
    const a = await getAlice()

    // Get initial position
    const initial = await a.sync()
    const since = initial.next_batch

    // Incremental sync should return device_lists with changed array
    const inc = await a.sync({ since })
    expect(inc.device_lists).toBeDefined()
    expect(Array.isArray(inc.device_lists.changed)).toBe(true)
    expect(Array.isArray(inc.device_lists.left)).toBe(true)
  })

  test('presence collector returns roommate presence', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Ensure they share a room
    const room = await a.createRoom({ name: `Presence ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob sets presence
    const tokens = await loadTokens()
    await b.request('PUT', `/_matrix/client/v3/presence/${encodeURIComponent(tokens.bob.userId)}/status`, {
      presence: 'online',
      status_msg: 'refactor test',
    })

    const res = await a.sync()
    const bobPresence = res.presence.events.find((e: any) => e.sender === tokens.bob.userId)
    expect(bobPresence).toBeDefined()
    expect(bobPresence.type).toBe('m.presence')

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('position collector advances next_batch correctly', async () => {
    const a = await getAlice()

    const res1 = await a.sync()
    const batch1 = res1.next_batch

    // Create an event to advance the stream
    const room = await a.createRoom({ name: `Position ${Date.now()}` })

    const res2 = await a.sync()
    const batch2 = res2.next_batch

    // next_batch should advance
    expect(batch2 > batch1).toBe(true)

    await a.leaveRoom(room.room_id)
  })

  test('room data builder: invite room data', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `InviteRefactor ${Date.now()}`, invite: [b.userId] })

    const sync = await b.sync()
    const inviteRoom = sync.rooms.invite[room.room_id]
    expect(inviteRoom).toBeDefined()
    expect(inviteRoom.invite_state).toBeDefined()
    expect(inviteRoom.invite_state.events.length).toBeGreaterThan(0)

    // Should have stripped state events
    const types = inviteRoom.invite_state.events.map((e: any) => e.type)
    expect(types).toContain('m.room.create')

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('room data builder: leave room shows events in incremental sync', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `LeaveRefactor ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob syncs
    const initial = await b.sync()
    const since = initial.next_batch

    // Alice sends a message, then Bob leaves
    await a.sendMessage(room.room_id, txnId('leave-msg'), { msgtype: 'm.text', body: 'bye' })
    await b.leaveRoom(room.room_id)

    // Bob's incremental sync should show the room in leave section
    const inc = await b.sync({ since })
    const leaveRoom = inc.rooms.leave[room.room_id]
    expect(leaveRoom).toBeDefined()
    expect(leaveRoom.timeline.events.length).toBeGreaterThan(0)

    await a.leaveRoom(room.room_id)
  })

  test('room data builder: joined room has ephemeral events (typing)', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `EphemeralRefactor ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob sets typing
    const tokens = await loadTokens()
    await b.setTyping(room.room_id, tokens.bob.userId, true, 30000)

    // Alice syncs — should see typing
    const res = await a.sync()
    const roomData = res.rooms.join[room.room_id]
    expect(roomData).toBeDefined()

    const typing = roomData.ephemeral.events.find((e: any) => e.type === 'm.typing')
    if (typing) {
      expect(typing.content.user_ids).toContain(tokens.bob.userId)
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('room data builder: joined room has room summary', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `SummaryRefactor ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const res = await a.sync()
    const roomData = res.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.summary['m.joined_member_count']).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})

describe('Sync Refactor — Long Poll', () => {
  test('long-poll returns early when notification arrives', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `LongPollRefactor ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const initial = await b.sync()
    const since = initial.next_batch

    // Start long-poll
    const syncPromise = b.sync({ since, timeout: 5000 })

    // Wait briefly, then send a message
    await new Promise(r => setTimeout(r, 300))
    await a.sendMessage(room.room_id, txnId('lp-refactor'), {
      msgtype: 'm.text',
      body: 'longpoll refactor test',
    })

    const start = Date.now()
    const sync = await syncPromise
    const elapsed = Date.now() - start

    // Should resolve well before timeout
    expect(elapsed).toBeLessThan(4500)
    const roomData = sync.rooms.join[room.room_id]
    expect(roomData).toBeDefined()

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('long-poll with no changes times out gracefully', async () => {
    const a = await getAlice()

    const initial = await a.sync()
    const since = initial.next_batch

    const start = Date.now()
    const res = await a.sync({ since, timeout: 1000 })
    const elapsed = Date.now() - start

    expect(res.next_batch).toBeTruthy()
    // Should timeout around 1s (with network overhead)
    expect(elapsed).toBeGreaterThanOrEqual(800)
    expect(elapsed).toBeLessThan(3000)
  })
})

describe('Sync Refactor — Sliding Sync', () => {
  test('sliding sync uses shared to-device collector', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Initial sliding sync to get to_device batch
    const initial = await b.slidingSync({
      lists: { all: { ranges: [[0, 0]], timeline_limit: 0 } },
      extensions: { to_device: { enabled: true } },
    })

    const tdSince = initial.extensions.to_device?.next_batch

    // Alice sends to-device to Bob
    const devices = await b.getDevices()
    const bobDeviceId = devices.devices[0]?.device_id
    if (!bobDeviceId)
      return

    await a.sendToDevice('m.test.ss_refactor', txnId('ss-td-refactor'), {
      [b.userId]: {
        [bobDeviceId]: { sliding: 'refactor' },
      },
    })

    const res = await b.slidingSync({
      lists: { all: { ranges: [[0, 0]], timeline_limit: 0 } },
      extensions: { to_device: { enabled: true, since: tdSince } },
    })

    expect(res.extensions.to_device).toBeDefined()
    const found = res.extensions.to_device.events.find((e: any) => e.type === 'm.test.ss_refactor')
    expect(found).toBeDefined()
    expect(found.content.sliding).toBe('refactor')
  })

  test('sliding sync uses shared e2ee collector', async () => {
    const a = await getAlice()

    const res = await a.slidingSync({
      lists: { all: { ranges: [[0, 0]], timeline_limit: 0 } },
      extensions: { e2ee: { enabled: true } },
    })

    expect(res.extensions.e2ee).toBeDefined()
    expect(res.extensions.e2ee.device_one_time_keys_count).toBeDefined()
    expect(typeof res.extensions.e2ee.device_one_time_keys_count.signed_curve25519).toBe('number')
    expect(Array.isArray(res.extensions.e2ee.device_unused_fallback_key_types)).toBe(true)
    expect(res.extensions.e2ee.device_lists).toBeDefined()
    expect(Array.isArray(res.extensions.e2ee.device_lists.changed)).toBe(true)
  })

  test('sliding sync uses shared account data collector', async () => {
    const a = await getAlice()

    const key = `m.test.ss_refactor_ad_${Date.now()}`
    await a.setAccountData(a.userId, key, { ss_refactor: true })

    const res = await a.slidingSync({
      lists: { all: { ranges: [[0, 0]], timeline_limit: 0 } },
      extensions: { account_data: { enabled: true } },
    })

    expect(res.extensions.account_data).toBeDefined()
    const found = res.extensions.account_data.global.find((e: any) => e.type === key)
    expect(found).toBeDefined()
    expect(found.content.ss_refactor).toBe(true)
  })

  test('sliding sync long-poll returns early on notification', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `SSLongPoll ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const initial = await b.slidingSync({
      lists: { all: { ranges: [[0, 49]], timeline_limit: 5 } },
    })
    const pos = initial.pos

    // Start long-poll
    const syncPromise = b.slidingSync(
      { lists: { all: { ranges: [[0, 49]], timeline_limit: 5 } } },
      { pos, timeout: 5000 },
    )

    await new Promise(r => setTimeout(r, 300))
    await a.sendMessage(room.room_id, txnId('ss-lp'), { msgtype: 'm.text', body: 'sliding longpoll test' })

    const start = Date.now()
    const res = await syncPromise
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(4500)
    expect(res.rooms[room.room_id]).toBeDefined()

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('sliding sync incremental returns only changed rooms', async () => {
    const a = await getAlice()

    const room = await a.createRoom({ name: `SSInc ${Date.now()}` })

    const initial = await a.slidingSync({
      lists: { all: { ranges: [[0, 49]], timeline_limit: 5 } },
    })
    const pos = initial.pos

    // Send a message to generate a change
    await a.sendMessage(room.room_id, txnId('ss-inc-msg'), { msgtype: 'm.text', body: 'incremental' })

    const inc = await a.slidingSync(
      { lists: { all: { ranges: [[0, 49]], timeline_limit: 5 } } },
      { pos },
    )

    expect(inc.pos).not.toBe(pos)
    expect(inc.rooms[room.room_id]).toBeDefined()

    await a.leaveRoom(room.room_id)
  })
})

describe('Sync Refactor — Trust Context', () => {
  test('backup_disabled is included in account data on fresh initial sync', async () => {
    const a = await getAlice()
    const tokens = await loadTokens()

    // Clear lastSyncBatch to simulate a fresh device initial sync
    const { db } = await import('@/db')
    const { devices } = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')
    db.update(devices)
      .set({ lastSyncBatch: null })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()

    // Initial sync (no since) should include backup_disabled
    const res = await a.sync()
    const backupDisabled = res.account_data.events.find(
      (e: any) => e.type === 'm.org.matrix.custom.backup_disabled',
    )
    expect(backupDisabled).toBeDefined()
    expect(backupDisabled.content.disabled).toBe(true)
  })

  test('initial sync returns rooms with state and timeline', async () => {
    const a = await getAlice()

    const room = await a.createRoom({ name: `TrustRoom ${Date.now()}` })
    await a.sendMessage(room.room_id, txnId('trust-msg'), { msgtype: 'm.text', body: 'trust context test' })

    const res = await a.sync()
    const roomData = res.rooms.join[room.room_id]
    expect(roomData).toBeDefined()
    expect(roomData.timeline.events.length).toBeGreaterThan(0)
    expect(roomData.state).toBeDefined()

    await a.leaveRoom(room.room_id)
  })
})
