import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { devices } from '@/db/schema'
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
})
