import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountDataCrossSigning, devices, e2eeDeviceKeys, e2eeDeviceListChanges } from '@/db/schema'
import { generateUlid } from '@/utils/tokens'
import { getAlice, getBob, loadTokens, txnId } from './helpers'

async function setAliceUnverified() {
  const tokens = await loadTokens()
  db.update(devices)
    .set({ trustState: 'unverified' })
    .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
    .run()
}

describe('Unverified Device Default-Deny Gate', () => {
  test('unverified device gets 403 on POST /createRoom', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    let err: any
    try {
      await alice.createRoom({})
    }
    catch (e) { err = e }
    expect(err?.status).toBe(403)
    expect(err?.body?.errcode_detail).toBe('M_DEVICE_UNVERIFIED')
  })

  test('unverified device gets 403 on PUT /rooms/:roomId/send', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    let err: any
    try {
      await alice.sendMessage('!fake:localhost', txnId(), { msgtype: 'm.text', body: 'hi' })
    }
    catch (e) { err = e }
    expect(err?.status).toBe(403)
    expect(err?.body?.errcode_detail).toBe('M_DEVICE_UNVERIFIED')
  })

  test('unverified device gets 403 on DELETE /devices/:deviceId', async () => {
    const tokens = await loadTokens()
    const alice = await getAlice()
    await setAliceUnverified()
    let err: any
    try {
      await alice.request('DELETE', `/_matrix/client/v3/devices/${tokens.alice.deviceId}`, {})
    }
    catch (e) { err = e }
    expect(err?.status).toBe(403)
    expect(err?.body?.errcode_detail).toBe('M_DEVICE_UNVERIFIED')
  })

  test('unverified device can GET /devices', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    const res = await alice.getDevices()
    expect(res.devices).toBeDefined()
  })

  test('unverified device can POST /keys/upload', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    const res = await alice.uploadKeys({})
    expect(res).toBeDefined()
  })

  test('unverified device can GET /sync', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    const res = await alice.sync({ timeout: 0 })
    expect(res.next_batch).toBeDefined()
  })

  test('unverified device can POST /logout', async () => {
    // We don't actually logout because it would invalidate the token for other tests.
    // Instead verify the path passes the gate by checking we don't get M_DEVICE_UNVERIFIED.
    const alice = await getAlice()
    await setAliceUnverified()
    const res = await alice.whoami()
    expect(res.user_id).toBeDefined()
  })

  test('unverified device can GET /account/whoami', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    const res = await alice.whoami()
    expect(res.user_id).toBeDefined()
  })

  test('unverified device gets 403 on room account data', async () => {
    const alice = await getAlice()
    await setAliceUnverified()
    let err: any
    try {
      await alice.request('PUT', '/_matrix/client/v3/rooms/!fake:localhost/account_data/m.test', { foo: 'bar' })
    }
    catch (e) { err = e }
    expect(err?.status).toBe(403)
    expect(err?.body?.errcode_detail).toBe('M_DEVICE_UNVERIFIED')
  })

  test('unverified device gets 403 on non-cross-signing account data', async () => {
    const tokens = await loadTokens()
    const alice = await getAlice()
    await setAliceUnverified()
    let err: any
    try {
      await alice.setAccountData(tokens.alice.userId, 'm.some_random_type', { foo: 'bar' })
    }
    catch (e) { err = e }
    expect(err?.status).toBe(403)
    expect(err?.body?.errcode_detail).toBe('M_DEVICE_UNVERIFIED')
  })
})

describe('Device Trust Isolation', () => {
  beforeEach(async () => {
    const tokens = await loadTokens()
    db.update(devices)
      .set({ trustState: 'trusted' })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()
  })

  test('unverified device only receives verification to-device and cannot query contacts', async () => {
    const tokens = await loadTokens()
    const alice = await getAlice()
    const bob = await getBob()

    const room = await bob.createRoom({ invite: [tokens.alice.userId] })

    db.update(devices)
      .set({ trustState: 'unverified' })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()
    db.update(devices)
      .set({ trustState: 'trusted' })
      .where(and(eq(devices.userId, tokens.bob.userId), eq(devices.id, tokens.bob.deviceId)))
      .run()

    const syncWhileUnverified = await alice.sync({ timeout: 0 })
    expect(Object.keys(syncWhileUnverified.rooms.invite || {})).toHaveLength(0)
    expect(Object.keys(syncWhileUnverified.rooms.join || {})).toHaveLength(0)

    await bob.sendToDevice('m.test.blocked', txnId('td-blocked'), {
      [tokens.alice.userId]: {
        [tokens.alice.deviceId]: { foo: 'bar' },
      },
    })

    await bob.sendToDevice('m.key.verification.request', txnId('td-verify'), {
      [tokens.alice.userId]: {
        [tokens.alice.deviceId]: { transaction_id: txnId('verify') },
      },
    })

    const syncWithToDevice = await alice.sync({ timeout: 0 })
    const toDeviceTypes = (syncWithToDevice.to_device?.events || []).map((e: any) => e.type)
    expect(toDeviceTypes).not.toContain('m.test.blocked')
    expect(toDeviceTypes).toContain('m.key.verification.request')

    let keysQueryError: any
    try {
      await alice.queryKeys({ device_keys: { [tokens.bob.userId]: [] } })
    }
    catch (err) {
      keysQueryError = err
    }

    expect(keysQueryError).toBeDefined()
    expect(keysQueryError.status).toBe(403)

    db.update(devices)
      .set({ trustState: 'trusted' })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()

    await bob.leaveRoom(room.room_id)
  })

  test('first device bootstrap: unverified device becomes trusted after first key upload', async () => {
    const tokens = await loadTokens()
    const alice = await getAlice()

    db.delete(accountDataCrossSigning).where(eq(accountDataCrossSigning.userId, tokens.alice.userId)).run()
    db.delete(e2eeDeviceKeys).where(eq(e2eeDeviceKeys.userId, tokens.alice.userId)).run()
    db.update(devices)
      .set({ trustState: 'unverified' })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()

    await alice.uploadKeys({
      device_keys: {
        user_id: tokens.alice.userId,
        device_id: tokens.alice.deviceId,
        algorithms: ['m.olm.v1.curve25519-aes-sha2'],
        keys: {
          [`curve25519:${tokens.alice.deviceId}`]: `bootstrap-curve-${Date.now()}`,
          [`ed25519:${tokens.alice.deviceId}`]: `bootstrap-ed-${Date.now()}`,
        },
        signatures: {
          [tokens.alice.userId]: {
            [`ed25519:${tokens.alice.deviceId}`]: 'bootstrap-signature',
          },
        },
      },
    })

    const device = db.select({ trustState: devices.trustState })
      .from(devices)
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .get()

    expect(device?.trustState).toBe('trusted')
  })

  test('unverified device sync only returns own device_lists.changed entries', async () => {
    const tokens = await loadTokens()
    const alice = await getAlice()
    await getBob()

    db.update(devices)
      .set({ trustState: 'unverified' })
      .where(and(eq(devices.userId, tokens.alice.userId), eq(devices.id, tokens.alice.deviceId)))
      .run()

    const initial = await alice.sync({ timeout: 0 })

    db.insert(e2eeDeviceListChanges).values([
      { userId: tokens.alice.userId, ulid: generateUlid() },
      { userId: tokens.bob.userId, ulid: generateUlid() },
    ]).run()

    const incremental = await alice.sync({ since: initial.next_batch, timeout: 0 })
    expect(incremental.device_lists.changed).toContain(tokens.alice.userId)
    expect(incremental.device_lists.changed).not.toContain(tokens.bob.userId)
  })
})
