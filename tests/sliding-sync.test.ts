import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'

describe('Sliding Sync (MSC3575)', () => {
  test('initial sync returns rooms sorted by recency', async () => {
    const a = await getAlice()

    // Create two rooms and send a message to the second one to make it more recent
    const room1 = await a.createRoom({ name: `SS-Old ${Date.now()}` })
    const room2 = await a.createRoom({ name: `SS-New ${Date.now()}` })
    await a.sendMessage(room2.room_id, txnId('ss'), { msgtype: 'm.text', body: 'recent' })

    const res = await a.slidingSync({
      lists: {
        all_rooms: {
          ranges: [[0, 19]],
          timeline_limit: 5,
        },
      },
    })

    expect(res.pos).toBeTruthy()
    expect(res.lists.all_rooms).toBeDefined()
    expect(res.lists.all_rooms.count).toBeGreaterThanOrEqual(2)
    expect(res.lists.all_rooms.ops).toHaveLength(1)
    expect(res.lists.all_rooms.ops[0].op).toBe('SYNC')

    const roomIds = res.lists.all_rooms.ops[0].room_ids
    expect(roomIds).toContain(room1.room_id)
    expect(roomIds).toContain(room2.room_id)

    // room2 should appear before room1 since it has a more recent event
    const idx1 = roomIds.indexOf(room1.room_id)
    const idx2 = roomIds.indexOf(room2.room_id)
    expect(idx2).toBeLessThan(idx1)

    // Rooms should have data
    expect(res.rooms[room2.room_id]).toBeDefined()
    expect(res.rooms[room2.room_id].initial).toBe(true)
    expect(res.rooms[room2.room_id].timeline.length).toBeGreaterThan(0)

    await a.leaveRoom(room1.room_id)
    await a.leaveRoom(room2.room_id)
  })

  test('room count matches actual joined rooms in filtered list', async () => {
    const a = await getAlice()

    const res = await a.slidingSync({
      lists: {
        all: {
          ranges: [[0, 99]],
          timeline_limit: 1,
        },
      },
    })

    // Compare with joined_rooms endpoint
    const joined = await a.joinedRooms()
    expect(res.lists.all.count).toBe(joined.joined_rooms.length)
  })

  test('incremental sync shows new room', async () => {
    const a = await getAlice()

    // Initial sync
    const initial = await a.slidingSync({
      lists: {
        all: {
          ranges: [[0, 49]],
          timeline_limit: 5,
        },
      },
    })

    const pos = initial.pos

    // Create a new room
    const room = await a.createRoom({ name: `SS-Inc ${Date.now()}` })

    // Incremental sync
    const inc = await a.slidingSync({
      lists: {
        all: {
          ranges: [[0, 49]],
          timeline_limit: 5,
        },
      },
    }, { pos })

    expect(inc.pos).not.toBe(pos)
    expect(inc.rooms[room.room_id]).toBeDefined()
    expect(inc.rooms[room.room_id].timeline.length).toBeGreaterThan(0)

    await a.leaveRoom(room.room_id)
  })

  test('is_dm filter works', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Create a DM room
    const dm = await a.createRoom({
      is_direct: true,
      invite: [b.userId],
      name: `SS-DM ${Date.now()}`,
    })
    await b.joinRoom(dm.room_id)

    // Create a non-DM room
    const regular = await a.createRoom({ name: `SS-Reg ${Date.now()}` })

    // Filter for DMs only
    const dmSync = await a.slidingSync({
      lists: {
        dms: {
          ranges: [[0, 49]],
          timeline_limit: 1,
          filters: { is_dm: true },
        },
      },
    })

    const dmRoomIds = dmSync.lists.dms.ops[0].room_ids
    expect(dmRoomIds).toContain(dm.room_id)
    expect(dmRoomIds).not.toContain(regular.room_id)

    // Filter for non-DMs only
    const nonDmSync = await a.slidingSync({
      lists: {
        rooms: {
          ranges: [[0, 49]],
          timeline_limit: 1,
          filters: { is_dm: false },
        },
      },
    })

    const nonDmRoomIds = nonDmSync.lists.rooms.ops[0].room_ids
    expect(nonDmRoomIds).toContain(regular.room_id)
    expect(nonDmRoomIds).not.toContain(dm.room_id)

    await a.leaveRoom(dm.room_id)
    await b.leaveRoom(dm.room_id)
    await a.leaveRoom(regular.room_id)
  })

  test('room_subscriptions returns specific room data', async () => {
    const a = await getAlice()

    const room = await a.createRoom({ name: `SS-Sub ${Date.now()}` })
    await a.sendMessage(room.room_id, txnId('ss-sub'), { msgtype: 'm.text', body: 'subscription test' })

    const res = await a.slidingSync({
      room_subscriptions: {
        [room.room_id]: {
          required_state: [['m.room.name', '']],
          timeline_limit: 10,
        },
      },
    })

    expect(res.rooms[room.room_id]).toBeDefined()
    expect(res.rooms[room.room_id].timeline.length).toBeGreaterThan(0)
    expect(res.rooms[room.room_id].required_state.length).toBeGreaterThan(0)

    // Check the name state event is present
    const nameEvent = res.rooms[room.room_id].required_state.find(
      (e: any) => e.type === 'm.room.name',
    )
    expect(nameEvent).toBeDefined()

    await a.leaveRoom(room.room_id)
  })

  test('timeline_limit is respected', async () => {
    const a = await getAlice()

    const room = await a.createRoom({ name: `SS-TL ${Date.now()}` })
    // Send 5 messages
    for (let i = 0; i < 5; i++) {
      await a.sendMessage(room.room_id, txnId(`ss-tl-${i}`), {
        msgtype: 'm.text',
        body: `message ${i}`,
      })
    }

    // Request with timeline_limit: 2
    const res = await a.slidingSync({
      room_subscriptions: {
        [room.room_id]: {
          timeline_limit: 2,
        },
      },
    })

    expect(res.rooms[room.room_id]).toBeDefined()
    expect(res.rooms[room.room_id].timeline.length).toBeLessThanOrEqual(2)

    await a.leaveRoom(room.room_id)
  })

  test('e2ee extension returns key counts', async () => {
    const a = await getAlice()

    const res = await a.slidingSync({
      lists: {
        all: {
          ranges: [[0, 0]],
          timeline_limit: 0,
        },
      },
      extensions: {
        e2ee: { enabled: true },
      },
    })

    expect(res.extensions.e2ee).toBeDefined()
    expect(res.extensions.e2ee.device_one_time_keys_count).toBeDefined()
    expect(typeof res.extensions.e2ee.device_one_time_keys_count.signed_curve25519).toBe('number')
    expect(Array.isArray(res.extensions.e2ee.device_unused_fallback_key_types)).toBe(true)
  })

  test('to_device extension works', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Do initial sliding sync to get to_device since token
    const initial = await b.slidingSync({
      lists: {
        all: { ranges: [[0, 0]], timeline_limit: 0 },
      },
      extensions: {
        to_device: { enabled: true },
      },
    })

    const tdSince = initial.extensions.to_device?.next_batch

    // Alice sends a to-device message to Bob
    const devices = await b.getDevices()
    const bobDeviceId = devices.devices[0]?.device_id
    if (bobDeviceId) {
      await a.sendToDevice('m.test.sliding', txnId('ss-td'), {
        [b.userId]: {
          [bobDeviceId]: { hello: 'sliding sync' },
        },
      })

      // Bob does sliding sync with to_device extension
      const res = await b.slidingSync({
        lists: {
          all: { ranges: [[0, 0]], timeline_limit: 0 },
        },
        extensions: {
          to_device: { enabled: true, since: tdSince },
        },
      })

      expect(res.extensions.to_device).toBeDefined()
      expect(res.extensions.to_device.events.length).toBeGreaterThanOrEqual(1)

      const found = res.extensions.to_device.events.find(
        (e: any) => e.type === 'm.test.sliding',
      )
      expect(found).toBeDefined()
      expect(found.content.hello).toBe('sliding sync')
    }
  })

  test('room name is returned', async () => {
    const a = await getAlice()

    const roomName = `SS-Name-${Date.now()}`
    const room = await a.createRoom({ name: roomName })

    const res = await a.slidingSync({
      room_subscriptions: {
        [room.room_id]: {
          timeline_limit: 1,
        },
      },
    })

    expect(res.rooms[room.room_id]).toBeDefined()
    expect(res.rooms[room.room_id].name).toBe(roomName)

    await a.leaveRoom(room.room_id)
  })

  test('notification counts are returned', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `SS-Notif ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Alice sends a message
    await a.sendMessage(room.room_id, txnId('ss-notif'), {
      msgtype: 'm.text',
      body: 'notification test',
    })

    // Bob does sliding sync
    const res = await b.slidingSync({
      room_subscriptions: {
        [room.room_id]: {
          timeline_limit: 10,
        },
      },
    })

    expect(res.rooms[room.room_id]).toBeDefined()
    expect(res.rooms[room.room_id].notification_count).toBeGreaterThanOrEqual(1)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('versions endpoint advertises sliding sync', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/versions`)
    const data = await res.json() as any
    expect(data.unstable_features['org.matrix.simplified_msc3575']).toBe(true)
  })

  test('account_data extension works', async () => {
    const a = await getAlice()

    // Set some account data
    await a.setAccountData(a.userId, 'm.test.sliding_sync', { test: true })

    const res = await a.slidingSync({
      lists: {
        all: { ranges: [[0, 0]], timeline_limit: 0 },
      },
      extensions: {
        account_data: { enabled: true },
      },
    })

    expect(res.extensions.account_data).toBeDefined()
    expect(Array.isArray(res.extensions.account_data.global)).toBe(true)

    const found = res.extensions.account_data.global.find(
      (e: any) => e.type === 'm.test.sliding_sync',
    )
    expect(found).toBeDefined()
    expect(found.content.test).toBe(true)
  })

  test('member counts are returned', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `SS-Counts ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const res = await a.slidingSync({
      room_subscriptions: {
        [room.room_id]: {
          timeline_limit: 1,
        },
      },
    })

    expect(res.rooms[room.room_id]).toBeDefined()
    expect(res.rooms[room.room_id].joined_count).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
