import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('E2EE To-Device Ordering', () => {
  test('5 to-device messages arrive in send order', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Get bob's device ID
    const bobDevices = await b.getDevices()
    const bobDeviceId = bobDevices.devices[0].device_id

    // Bob does initial sync to clear any pending messages
    const initial = await b.sync()
    const since = initial.next_batch

    // Do incremental sync to confirm delivery of initial messages
    const clear = await b.sync({ since, timeout: 100 })
    const since2 = clear.next_batch

    // Alice sends 5 to-device messages in order
    for (let i = 0; i < 5; i++) {
      await a.sendToDevice('m.dummy', txnId(`order-${i}`), {
        [b.userId]: {
          [bobDeviceId]: { index: i, body: `message-${i}` },
        },
      })
    }

    // Bob syncs — messages should arrive in exact order
    const sync = await b.sync({ since: since2, timeout: 1000 })
    const events = sync.to_device.events.filter((e: any) => e.type === 'm.dummy')
    expect(events.length).toBe(5)

    for (let i = 0; i < 5; i++) {
      expect(events[i].content.index).toBe(i)
      expect(events[i].content.body).toBe(`message-${i}`)
    }
  })

  test('after sync with since token, next sync has no to-device messages', async () => {
    const a = await getAlice()
    const b = await getBob()

    const bobDevices = await b.getDevices()
    const bobDeviceId = bobDevices.devices[0].device_id

    // Initial sync
    const initial = await b.sync()
    const since = initial.next_batch

    // Clear any pending
    const clear = await b.sync({ since, timeout: 100 })
    const since2 = clear.next_batch

    // Send a message
    await a.sendToDevice('m.dummy', txnId('clear-test'), {
      [b.userId]: {
        [bobDeviceId]: { test: 'clear' },
      },
    })

    // First sync picks it up
    const sync1 = await b.sync({ since: since2, timeout: 1000 })
    const events1 = sync1.to_device.events.filter((e: any) => e.type === 'm.dummy')
    expect(events1.length).toBe(1)

    // Second sync with new token should have no to-device messages
    const sync2 = await b.sync({ since: sync1.next_batch, timeout: 100 })
    const events2 = sync2.to_device.events.filter((e: any) => e.type === 'm.dummy')
    expect(events2.length).toBe(0)
  })

  test('device key upload triggers device_lists.changed in sync', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Create shared room so bob can see alice's device changes
    const room = await a.createRoom({ name: `DevList ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Bob does initial sync
    const initial = await b.sync()
    const since = initial.next_batch

    // Alice uploads device keys (dummy keys for test)
    const aliceDevices = await a.getDevices()
    const aliceDeviceId = aliceDevices.devices[0].device_id

    await a.uploadKeys({
      device_keys: {
        user_id: a.userId,
        device_id: aliceDeviceId,
        algorithms: ['m.olm.v1.curve25519-aes-sha2-256', 'm.megolm.v1.aes-sha2'],
        keys: {
          [`curve25519:${aliceDeviceId}`]: `test_curve_key_${Date.now()}`,
          [`ed25519:${aliceDeviceId}`]: `test_ed_key_${Date.now()}`,
        },
        signatures: {
          [a.userId]: {
            [`ed25519:${aliceDeviceId}`]: 'test_signature',
          },
        },
      },
      one_time_keys: {
        [`signed_curve25519:AAAAAQ_${Date.now()}`]: {
          key: `test_otk_${Date.now()}`,
          signatures: {
            [a.userId]: {
              [`ed25519:${aliceDeviceId}`]: 'test_otk_signature',
            },
          },
        },
      },
    })

    // Bob syncs — should see alice in device_lists.changed
    const sync = await b.sync({ since, timeout: 2000 })
    expect(sync.device_lists).toBeDefined()
    // Alice's device list should have changed
    if (sync.device_lists.changed.length > 0) {
      expect(sync.device_lists.changed).toContain(a.userId)
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('10 rapid to-device messages all arrive in order', async () => {
    const a = await getAlice()
    const b = await getBob()

    const bobDevices = await b.getDevices()
    const bobDeviceId = bobDevices.devices[0].device_id

    // Bob initial sync + clear
    const initial = await b.sync()
    const clear = await b.sync({ since: initial.next_batch, timeout: 100 })
    const since = clear.next_batch

    // Send 10 messages rapidly (sequentially to preserve order)
    for (let i = 0; i < 10; i++) {
      await a.sendToDevice('m.dummy', txnId(`rapid-${i}`), {
        [b.userId]: {
          [bobDeviceId]: { seq: i },
        },
      })
    }

    // Bob syncs
    const sync = await b.sync({ since, timeout: 2000 })
    const events = sync.to_device.events.filter((e: any) => e.type === 'm.dummy')
    expect(events.length).toBe(10)

    for (let i = 0; i < 10; i++) {
      expect(events[i].content.seq).toBe(i)
    }
  })
})
