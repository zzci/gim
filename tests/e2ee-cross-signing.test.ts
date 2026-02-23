import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

function buildCrossSigningPayload(userId: string, suffix: string) {
  const masterId = `master-${suffix}`
  const selfId = `self-${suffix}`
  const userIdKey = `user-${suffix}`
  return {
    master_key: {
      user_id: userId,
      usage: ['master'],
      keys: { [`ed25519:${masterId}`]: `master-pub-${suffix}` },
      signatures: {
        [userId]: { [`ed25519:${masterId}`]: `master-sig-${suffix}` },
      },
    },
    self_signing_key: {
      user_id: userId,
      usage: ['self_signing'],
      keys: { [`ed25519:${selfId}`]: `self-pub-${suffix}` },
      signatures: {
        [userId]: { [`ed25519:${masterId}`]: `self-sig-${suffix}` },
      },
    },
    user_signing_key: {
      user_id: userId,
      usage: ['user_signing'],
      keys: { [`ed25519:${userIdKey}`]: `user-pub-${suffix}` },
      signatures: {
        [userId]: { [`ed25519:${masterId}`]: `user-sig-${suffix}` },
      },
    },
  }
}

describe('E2EE Cross-Signing Reset Guard', () => {
  test('reset requires auth and performs delete->insert semantics', async () => {
    const a = await getAlice()
    const b = await getBob()

    const payloadA = buildCrossSigningPayload(a.userId, txnId('csA'))
    const payloadB = buildCrossSigningPayload(a.userId, txnId('csB'))

    // Baseline: allow initial set or existing-key reset using explicit re-auth.
    await a.uploadCrossSigningKeys({
      ...payloadA,
      reset: true,
      auth: {
        type: 'm.login.reauth',
        session: a.accessToken,
        user_id: a.userId,
      },
    })

    // Same metadata upload should be idempotent (no reset required).
    await a.uploadCrossSigningKeys(payloadA)

    // Different metadata without re-auth should be rejected.
    let rejected = false
    try {
      await a.uploadCrossSigningKeys(payloadB)
    }
    catch (err: any) {
      rejected = true
      expect(err.status).toBe(403)
      expect(err.body?.errcode).toBe('M_FORBIDDEN')
    }
    expect(rejected).toBe(true)

    // Different metadata with re-auth should pass.
    await a.uploadCrossSigningKeys({
      ...payloadB,
      reset: true,
      auth: {
        type: 'm.login.reauth',
        session: a.accessToken,
        user_id: a.userId,
      },
    })

    // Verify latest metadata is visible through /keys/query.
    const queried = await b.queryKeys({ device_keys: { [a.userId]: [] } })
    const master = queried.master_keys?.[a.userId]
    expect(master).toBeDefined()

    const expectedKey = payloadB.master_key.keys[Object.keys(payloadB.master_key.keys)[0]!]
    const returnedKey = master.keys[Object.keys(master.keys)[0]!]
    expect(returnedKey).toBe(expectedKey)
  })
})
