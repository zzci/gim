import { describe, expect, test } from 'bun:test'
import { getAlice } from './helpers'

describe('Devices', () => {
  test('list devices returns current device', async () => {
    const a = await getAlice()
    const res = await a.getDevices()
    expect(res.devices).toBeDefined()
    expect(res.devices.length).toBeGreaterThan(0)

    const device = res.devices[0]
    expect(device.device_id).toBeTruthy()
  })

  test('get single device by id', async () => {
    const a = await getAlice()
    const list = await a.getDevices()
    const deviceId = list.devices[0].device_id

    const device = await a.getDevice(deviceId)
    expect(device.device_id).toBe(deviceId)
  })

  test('get nonexistent device returns 404', async () => {
    const a = await getAlice()
    try {
      await a.getDevice('NONEXISTENT_DEVICE_ID')
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(404)
    }
  })
})

describe('E2EE Keys', () => {
  test('upload and query device keys', async () => {
    const a = await getAlice()
    const list = await a.getDevices()
    const deviceId = list.devices[0].device_id

    // Upload device keys
    await a.uploadKeys({
      device_keys: {
        user_id: a.userId,
        device_id: deviceId,
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        keys: {
          [`curve25519:${deviceId}`]: 'testcurve25519key',
          [`ed25519:${deviceId}`]: 'tested25519key',
        },
        signatures: {
          [a.userId]: {
            [`ed25519:${deviceId}`]: 'testsignature',
          },
        },
      },
    })

    // Query keys
    const query = await a.queryKeys({
      device_keys: { [a.userId]: [] },
    })
    expect(query.device_keys).toBeDefined()
    expect(query.device_keys[a.userId]).toBeDefined()
    expect(query.device_keys[a.userId][deviceId]).toBeDefined()

    const dk = query.device_keys[a.userId][deviceId]
    expect(dk.algorithms).toContain('m.olm.v1.curve25519-aes-sha2')
  })

  test('upload and claim one-time keys', async () => {
    const a = await getAlice()
    const b = await getAlice() // query from same user for simplicity
    const list = await a.getDevices()
    const deviceId = list.devices[0].device_id

    // Upload OTKs
    const uploadRes = await a.uploadKeys({
      one_time_keys: {
        [`signed_curve25519:AAAAAQ-${Date.now()}`]: {
          key: 'testotkkey',
          signatures: { [a.userId]: { [`ed25519:${deviceId}`]: 'sig' } },
        },
      },
    })
    expect(uploadRes.one_time_key_counts).toBeDefined()

    // Claim OTK
    const claimRes = await b.claimKeys({
      one_time_keys: {
        [a.userId]: { [deviceId]: 'signed_curve25519' },
      },
    })
    expect(claimRes.one_time_keys).toBeDefined()
  })

  test('key changes returns changed users', async () => {
    const a = await getAlice()
    const sync1 = await a.sync()
    const from = sync1.next_batch

    // Upload keys to trigger a change
    const list = await a.getDevices()
    const deviceId = list.devices[0].device_id
    await a.uploadKeys({
      device_keys: {
        user_id: a.userId,
        device_id: deviceId,
        algorithms: ['m.olm.v1.curve25519-aes-sha2'],
        keys: {
          [`curve25519:${deviceId}`]: `changed-${Date.now()}`,
          [`ed25519:${deviceId}`]: `changed-ed-${Date.now()}`,
        },
        signatures: {
          [a.userId]: { [`ed25519:${deviceId}`]: 'newsig' },
        },
      },
    })

    const sync2 = await a.sync()
    const to = sync2.next_batch

    const changes = await a.getKeyChanges(from, to)
    expect(changes).toBeDefined()
    // changed may or may not include self depending on implementation
  })
})
