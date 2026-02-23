/**
 * 09-device-verification: Device-to-device key sharing with verification.
 *
 * Keys NEVER stored on the server. Flow:
 *   1. Bob device A is the existing trusted device (has cross-signing keys)
 *   2. Bob device B is a new login — unverified
 *   3. Alice sends encrypted message; device B has no keys, can't decrypt
 *   4. Device A and B perform interactive verification (SAS) via sendToDevice
 *   5. After verification, device A cross-signs device B
 *   6. Device B requests keys from device A (m.room_key_request)
 *   7. Device A checks cross-signing, confirms B is verified, forwards keys
 *   8. Device B can now decrypt
 *   9. All keys are transient — only passed via to-device, never persisted on server
 */

import { alice, loadTokens, loginNewDevice } from './config'

async function main() {
  const tokens = await loadTokens()
  const a = await alice()
  const aliceDeviceId = tokens.alice.deviceId

  console.log('--- 09-device-verification ---')
  let pass = true

  // ================================================================
  // Phase 1: Setup — Bob device A is the trusted device
  // ================================================================

  console.log('\n=== Phase 1: Bob device A (trusted) setup ===')

  console.log('\n1. Bob logs in on device A (trusted)...')
  const { client: bobA, deviceId: bobDevA } = await loginNewDevice('bob', 'Bob Phone (trusted)')
  console.log(`   device A: ${bobDevA}`)

  // Upload device keys
  await bobA.uploadKeys({
    device_keys: {
      user_id: bobA.userId,
      device_id: bobDevA,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDevA}`]: 'bobA-curve25519-trusted',
        [`ed25519:${bobDevA}`]: 'bobA-ed25519-trusted',
      },
      signatures: {
        [bobA.userId]: { [`ed25519:${bobDevA}`]: 'bobA-device-sig' },
      },
    },
  })

  // 2. Device A uploads cross-signing keys (master, self-signing, user-signing)
  console.log('\n2. Device A uploads cross-signing keys...')
  const masterKeyId = 'master-key-id-bob'
  const selfSigningKeyId = 'self-signing-key-id-bob'
  await bobA.uploadCrossSigningKeys({
    master_key: {
      user_id: bobA.userId,
      usage: ['master'],
      keys: { [`ed25519:${masterKeyId}`]: 'bob-master-pubkey' },
      signatures: {
        [bobA.userId]: { [`ed25519:${bobDevA}`]: 'master-signed-by-devA' },
      },
    },
    self_signing_key: {
      user_id: bobA.userId,
      usage: ['self_signing'],
      keys: { [`ed25519:${selfSigningKeyId}`]: 'bob-self-signing-pubkey' },
      signatures: {
        [bobA.userId]: { [`ed25519:${masterKeyId}`]: 'self-signing-signed-by-master' },
      },
    },
    user_signing_key: {
      user_id: bobA.userId,
      usage: ['user_signing'],
      keys: { [`ed25519:user-signing-key-id-bob`]: 'bob-user-signing-pubkey' },
      signatures: {
        [bobA.userId]: { [`ed25519:${masterKeyId}`]: 'user-signing-signed-by-master' },
      },
    },
  })
  console.log('   cross-signing keys uploaded (master, self_signing, user_signing)')

  // 3. Self-sign device A with the self-signing key
  console.log('\n3. Cross-sign device A (self-signing → device A)...')
  await bobA.uploadSignatures({
    [bobA.userId]: {
      [bobDevA]: {
        user_id: bobA.userId,
        device_id: bobDevA,
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        keys: {
          [`curve25519:${bobDevA}`]: 'bobA-curve25519-trusted',
          [`ed25519:${bobDevA}`]: 'bobA-ed25519-trusted',
        },
        signatures: {
          [bobA.userId]: {
            [`ed25519:${bobDevA}`]: 'bobA-device-sig',
            [`ed25519:${selfSigningKeyId}`]: 'devA-signed-by-self-signing',
          },
        },
      },
    },
  })
  console.log('   device A is now cross-signed (verified)')

  // Upload Alice's device keys too
  await a.uploadKeys({
    device_keys: {
      user_id: a.userId,
      device_id: aliceDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${aliceDeviceId}`]: 'alice-curve25519-key',
        [`ed25519:${aliceDeviceId}`]: 'alice-ed25519-key',
      },
      signatures: {
        [a.userId]: { [`ed25519:${aliceDeviceId}`]: 'alice-sig' },
      },
    },
  })

  // Initial sync for device A
  const syncA0 = await bobA.sync({ timeout: 0 })

  // ================================================================
  // Phase 2: Device B logs in — UNVERIFIED
  // ================================================================

  console.log('\n=== Phase 2: Device B (new, unverified) ===')

  console.log('\n4. Bob logs in on device B (new)...')
  const { client: bobB, deviceId: bobDevB } = await loginNewDevice('bob', 'Bob Laptop (new)')
  console.log(`   device B: ${bobDevB}`)

  await bobB.uploadKeys({
    device_keys: {
      user_id: bobB.userId,
      device_id: bobDevB,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDevB}`]: 'bobB-curve25519-new',
        [`ed25519:${bobDevB}`]: 'bobB-ed25519-new',
      },
      signatures: {
        [bobB.userId]: { [`ed25519:${bobDevB}`]: 'bobB-device-sig' },
      },
    },
  })

  // 5. Check: device B is NOT cross-signed yet
  console.log('\n5. Checking device B verification status...')
  const queryBefore = await bobA.queryKeys({ device_keys: { [bobB.userId]: [] } })
  const devBKeysBefore = queryBefore.device_keys?.[bobB.userId]?.[bobDevB]
  const devBSigs = devBKeysBefore?.signatures?.[bobB.userId] || {}
  const hasCrossSignature = Object.keys(devBSigs).some((k: string) => k.includes(selfSigningKeyId))
  console.log(`   device B cross-signed: ${hasCrossSignature}`)
  if (hasCrossSignature) {
    console.log('   FAIL: device B should NOT be cross-signed yet')
    pass = false
  }
  else {
    console.log('   correct — device B is unverified')
  }

  // 6. Alice sends room key — only to device A (trusted), NOT to device B (unverified)
  console.log('\n6. Alice sends room key — ONLY to verified device A...')
  const sessionId = `session-${Date.now()}`
  await a.sendToDevice('m.room_key', `txn-verified-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!secret-room:example.com',
        session_id: sessionId,
        session_key: 'megolm-session-key-for-devA',
        chain_index: 0,
      },
      // Device B is intentionally excluded — not verified
    },
  })
  console.log('   sent to device A only (device B excluded: unverified)')

  // Device A receives the key
  const syncA1 = await bobA.sync({ since: syncA0.next_batch, timeout: 0 })
  const roomKeyA = (syncA1.to_device?.events || []).find(
    (e: any) => e.type === 'm.room_key' && e.content.session_id === sessionId,
  )
  console.log(`   device A received key: ${!!roomKeyA}`)

  // Device B initial sync — should NOT have any room key
  const syncB0 = await bobB.sync({ timeout: 0 })
  const roomKeyB0 = (syncB0.to_device?.events || []).find(
    (e: any) => e.type === 'm.room_key' && e.content.session_id === sessionId,
  )
  console.log(`   device B has key: ${!!roomKeyB0}`)
  if (roomKeyB0) {
    console.log('   FAIL: unverified device B should NOT have received key')
    pass = false
  }
  else {
    console.log('   correct — device B has no key (can\'t decrypt)')
  }

  // ================================================================
  // Phase 3: SAS Verification between device A and device B
  // ================================================================

  console.log('\n=== Phase 3: Interactive verification (SAS) ===')

  const verifyTxnId = `verify-${Date.now()}`

  // 7. Device B initiates verification request
  console.log('\n7. Device B → A: m.key.verification.request...')
  await bobB.sendToDevice('m.key.verification.request', `txn-vreq-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        from_device: bobDevB,
        methods: ['m.sas.v1'],
        transaction_id: verifyTxnId,
        timestamp: Date.now(),
      },
    },
  })

  // Device A receives the request
  const syncA2 = await bobA.sync({ since: syncA1.next_batch, timeout: 0 })
  const vRequest = (syncA2.to_device?.events || []).find(
    (e: any) => e.type === 'm.key.verification.request',
  )
  console.log(`   device A received request: ${!!vRequest}`)
  if (vRequest) {
    console.log(`   from_device: ${vRequest.content.from_device}`)
    console.log(`   methods: ${JSON.stringify(vRequest.content.methods)}`)
  }

  // 8. Device A accepts: m.key.verification.ready
  console.log('\n8. Device A → B: m.key.verification.ready...')
  await bobA.sendToDevice('m.key.verification.ready', `txn-vready-${Date.now()}`, {
    [bobB.userId]: {
      [bobDevB]: {
        from_device: bobDevA,
        methods: ['m.sas.v1'],
        transaction_id: verifyTxnId,
      },
    },
  })

  const syncB1 = await bobB.sync({ since: syncB0.next_batch, timeout: 0 })
  const vReady = (syncB1.to_device?.events || []).find(
    (e: any) => e.type === 'm.key.verification.ready',
  )
  console.log(`   device B received ready: ${!!vReady}`)

  // 9. Device B starts SAS: m.key.verification.start
  console.log('\n9. Device B → A: m.key.verification.start (SAS)...')
  await bobB.sendToDevice('m.key.verification.start', `txn-vstart-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        from_device: bobDevB,
        method: 'm.sas.v1',
        transaction_id: verifyTxnId,
        key_agreement_protocols: ['curve25519-hkdf-sha256'],
        hashes: ['sha256'],
        message_authentication_codes: ['hkdf-hmac-sha256.v2'],
        short_authentication_string: ['decimal', 'emoji'],
      },
    },
  })

  const syncA3 = await bobA.sync({ since: syncA2.next_batch, timeout: 0 })
  const vStart = (syncA3.to_device?.events || []).find(
    (e: any) => e.type === 'm.key.verification.start',
  )
  console.log(`   device A received start: ${!!vStart}`)

  // 10. Key exchange: both send m.key.verification.key
  console.log('\n10. Key exchange (both directions)...')
  await bobA.sendToDevice('m.key.verification.key', `txn-vkey-a-${Date.now()}`, {
    [bobB.userId]: {
      [bobDevB]: {
        transaction_id: verifyTxnId,
        key: 'device-A-ephemeral-pubkey-for-SAS',
      },
    },
  })
  await bobB.sendToDevice('m.key.verification.key', `txn-vkey-b-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        transaction_id: verifyTxnId,
        key: 'device-B-ephemeral-pubkey-for-SAS',
      },
    },
  })

  const syncB2 = await bobB.sync({ since: syncB1.next_batch, timeout: 0 })
  const syncA4 = await bobA.sync({ since: syncA3.next_batch, timeout: 0 })
  const vKeyB = (syncB2.to_device?.events || []).find((e: any) => e.type === 'm.key.verification.key')
  const vKeyA = (syncA4.to_device?.events || []).find((e: any) => e.type === 'm.key.verification.key')
  console.log(`   device A received B's key: ${!!vKeyA}`)
  console.log(`   device B received A's key: ${!!vKeyB}`)

  // 11. Both send MAC: m.key.verification.mac
  //     (In reality: HMAC of device keys using the SAS shared secret)
  console.log('\n11. MAC exchange (both verify emoji match)...')
  await bobA.sendToDevice('m.key.verification.mac', `txn-vmac-a-${Date.now()}`, {
    [bobB.userId]: {
      [bobDevB]: {
        transaction_id: verifyTxnId,
        keys: 'hmac-of-all-key-ids',
        mac: {
          [`ed25519:${bobDevA}`]: 'hmac-of-devA-ed25519-key',
        },
      },
    },
  })
  await bobB.sendToDevice('m.key.verification.mac', `txn-vmac-b-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        transaction_id: verifyTxnId,
        keys: 'hmac-of-all-key-ids',
        mac: {
          [`ed25519:${bobDevB}`]: 'hmac-of-devB-ed25519-key',
        },
      },
    },
  })

  const syncB3 = await bobB.sync({ since: syncB2.next_batch, timeout: 0 })
  const syncA5 = await bobA.sync({ since: syncA4.next_batch, timeout: 0 })
  const vMacB = (syncB3.to_device?.events || []).find((e: any) => e.type === 'm.key.verification.mac')
  const vMacA = (syncA5.to_device?.events || []).find((e: any) => e.type === 'm.key.verification.mac')
  console.log(`   device A received B's MAC: ${!!vMacA}`)
  console.log(`   device B received A's MAC: ${!!vMacB}`)

  // 12. Both send done: m.key.verification.done
  console.log('\n12. Verification done...')
  await bobA.sendToDevice('m.key.verification.done', `txn-vdone-a-${Date.now()}`, {
    [bobB.userId]: {
      [bobDevB]: { transaction_id: verifyTxnId },
    },
  })
  await bobB.sendToDevice('m.key.verification.done', `txn-vdone-b-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: { transaction_id: verifyTxnId },
    },
  })
  console.log('   SAS verification complete')

  // ================================================================
  // Phase 4: Cross-sign device B (now verified)
  // ================================================================

  console.log('\n=== Phase 4: Cross-sign device B ===')

  // 13. Device A cross-signs device B with self-signing key
  console.log('\n13. Device A cross-signs device B...')
  await bobA.uploadSignatures({
    [bobB.userId]: {
      [bobDevB]: {
        user_id: bobB.userId,
        device_id: bobDevB,
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        keys: {
          [`curve25519:${bobDevB}`]: 'bobB-curve25519-new',
          [`ed25519:${bobDevB}`]: 'bobB-ed25519-new',
        },
        signatures: {
          [bobB.userId]: {
            [`ed25519:${bobDevB}`]: 'bobB-device-sig',
            [`ed25519:${selfSigningKeyId}`]: 'devB-signed-by-self-signing-NOW-VERIFIED',
          },
        },
      },
    },
  })
  console.log('   device B is now cross-signed')

  // 14. Verify the cross-signature is visible
  console.log('\n14. Verifying cross-signature on device B...')
  const queryAfter = await bobA.queryKeys({ device_keys: { [bobB.userId]: [] } })
  const devBKeysAfter = queryAfter.device_keys?.[bobB.userId]?.[bobDevB]
  const devBSigsAfter = devBKeysAfter?.signatures?.[bobB.userId] || {}
  const hasCrossSigNow = Object.keys(devBSigsAfter).some((k: string) => k.includes(selfSigningKeyId))
  console.log(`   device B cross-signed: ${hasCrossSigNow}`)
  if (!hasCrossSigNow) {
    console.log('   FAIL: device B should be cross-signed now')
    pass = false
  }

  // ================================================================
  // Phase 5: Key sharing — device B requests, device A forwards
  // ================================================================

  console.log('\n=== Phase 5: Key request & forward (device-to-device) ===')

  // 15. Device B sends m.room_key_request to device A
  console.log('\n15. Device B → A: m.room_key_request...')
  const requestId = `key-req-${Date.now()}`
  await bobB.sendToDevice('m.room_key_request', `txn-keyreq-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        action: 'request',
        requesting_device_id: bobDevB,
        request_id: requestId,
        body: {
          algorithm: 'm.megolm.v1.aes-sha2',
          room_id: '!secret-room:example.com',
          session_id: sessionId,
          sender_key: 'alice-curve25519-key',
        },
      },
    },
  })

  // Device A receives the request
  const syncA6 = await bobA.sync({ since: syncA5.next_batch, timeout: 0 })
  const keyRequest = (syncA6.to_device?.events || []).find(
    (e: any) => e.type === 'm.room_key_request' && e.content.action === 'request',
  )
  console.log(`   device A received request: ${!!keyRequest}`)
  if (keyRequest) {
    console.log(`   requesting device: ${keyRequest.content.requesting_device_id}`)
    console.log(`   session: ${keyRequest.content.body.session_id}`)
  }

  // 16. Device A checks verification status, then forwards the key
  console.log('\n16. Device A verifies B is cross-signed, then forwards key...')
  // (Client-side check: query device B's signatures, confirm self-signing key present)
  const checkQuery = await bobA.queryKeys({ device_keys: { [bobB.userId]: [bobDevB] } })
  const checkSigs = checkQuery.device_keys?.[bobB.userId]?.[bobDevB]?.signatures?.[bobB.userId] || {}
  const isVerified = Object.keys(checkSigs).some((k: string) => k.includes(selfSigningKeyId))
  console.log(`   device B verified: ${isVerified}`)

  if (isVerified) {
    await bobA.sendToDevice('m.forwarded_room_key', `txn-fwd-${Date.now()}`, {
      [bobB.userId]: {
        [bobDevB]: {
          algorithm: 'm.megolm.v1.aes-sha2',
          room_id: '!secret-room:example.com',
          session_id: sessionId,
          session_key: 'megolm-session-key-for-devA',
          sender_key: 'alice-curve25519-key',
          sender_claimed_ed25519_key: 'alice-ed25519-key',
          forwarding_curve25519_key_chain: ['bobA-curve25519-trusted'],
          chain_index: 0,
        },
      },
    })
    console.log('   forwarded room key to device B')
  }
  else {
    console.log('   FAIL: device B is not verified, refusing to forward')
    pass = false
  }

  // 17. Device B receives the forwarded key
  console.log('\n17. Device B receives forwarded key...')
  const syncB4 = await bobB.sync({ since: syncB3.next_batch, timeout: 0 })
  const forwardedKey = (syncB4.to_device?.events || []).find(
    (e: any) => e.type === 'm.forwarded_room_key' && e.content.session_id === sessionId,
  )
  if (forwardedKey) {
    console.log(`   session_id: ${forwardedKey.content.session_id}`)
    console.log(`   session_key: ${forwardedKey.content.session_key}`)
    console.log(`   forwarding_chain: [${forwardedKey.content.forwarding_curve25519_key_chain.join(', ')}]`)
    console.log('   device B can now decrypt!')
  }
  else {
    console.log('   FAIL: device B did not receive forwarded key')
    pass = false
  }

  // 18. Verify keys are NOT on server — next sync has no to-device events
  console.log('\n18. Verify keys are transient (not re-delivered)...')
  const syncB5 = await bobB.sync({ since: syncB4.next_batch, timeout: 0 })
  const leftover = (syncB5.to_device?.events || []).filter(
    (e: any) => e.type === 'm.forwarded_room_key' || e.type === 'm.room_key',
  )
  console.log(`   leftover key events: ${leftover.length}`)
  if (leftover.length > 0) {
    console.log('   FAIL: keys should not be re-delivered')
    pass = false
  }
  else {
    console.log('   correct — keys consumed, not persisted on server')
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log('\n=== Summary ===')
  console.log('   Key flow: Alice → device A (sendToDevice) → device B (forwarded)')
  console.log('   Server role: transport only, keys deleted after sync delivery')
  console.log('   Verification: SAS (7 messages) → cross-sign → then key forward')
  console.log('   Unverified device B: blocked from receiving keys until verified')

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
