import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { accountData, devices, e2eeDeviceKeys } from '@/db/schema'
import { getAlice, getBob, loadTokens, txnId } from './helpers'

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

    db.delete(accountData).where(and(
      eq(accountData.userId, tokens.alice.userId),
      eq(accountData.roomId, ''),
      inArray(accountData.type, ['m.cross_signing.master', 'm.cross_signing.self_signing', 'm.cross_signing.user_signing']),
    )).run()
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
})
