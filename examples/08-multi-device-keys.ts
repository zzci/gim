/**
 * 08-multi-device-keys: Multi-device E2EE key sharing and backup.
 *
 * Scenario:
 *   Bob has two devices (devA, devB) with different identity keys.
 *   Alice shares a Megolm room key to both devices.
 *   Both devices independently sync and receive the key.
 *   Device A logs out but first backs up its session keys via dehydrated device.
 *   Device B retrieves the dehydrated device events to import A's keys.
 *
 * This simulates the real-world flow:
 *   1. Multi-device key distribution (Alice → Bob's all devices)
 *   2. Per-device Olm sessions (different identity keys)
 *   3. Key backup via dehydrated device on logout
 *   4. Key import from dehydrated device on another device
 */

import { alice, loadTokens, loginNewDevice } from './config'

async function main() {
  const tokens = await loadTokens()
  const a = await alice()
  const aliceDeviceId = tokens.alice.deviceId

  console.log('--- 08-multi-device-keys ---')
  let pass = true

  // ================================================================
  // Phase 1: Bob logs in on two devices with different identity keys
  // ================================================================

  console.log('\n=== Phase 1: Bob two-device login ===')

  console.log('\n1. Bob logs in on device A...')
  const { client: bobA, deviceId: bobDevA } = await loginNewDevice('bob', 'Bob Phone')
  console.log(`   device A: ${bobDevA}`)

  console.log('\n2. Bob logs in on device B...')
  const { client: bobB, deviceId: bobDevB } = await loginNewDevice('bob', 'Bob Laptop')
  console.log(`   device B: ${bobDevB}`)

  // Verify two distinct devices
  if (bobDevA === bobDevB) {
    console.log('   FAIL: devices should have different IDs')
    pass = false
  }

  // 3. Upload different identity keys for each device
  console.log('\n3. Uploading identity keys (different per device)...')
  await bobA.uploadKeys({
    device_keys: {
      user_id: bobA.userId,
      device_id: bobDevA,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDevA}`]: 'bobA-curve25519-AAAA',
        [`ed25519:${bobDevA}`]: 'bobA-ed25519-BBBB',
      },
      signatures: {
        [bobA.userId]: { [`ed25519:${bobDevA}`]: 'bobA-sig' },
      },
    },
  })
  await bobB.uploadKeys({
    device_keys: {
      user_id: bobB.userId,
      device_id: bobDevB,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDevB}`]: 'bobB-curve25519-CCCC',
        [`ed25519:${bobDevB}`]: 'bobB-ed25519-DDDD',
      },
      signatures: {
        [bobB.userId]: { [`ed25519:${bobDevB}`]: 'bobB-sig' },
      },
    },
  })
  console.log('   device A keys: curve25519=bobA-curve25519-AAAA')
  console.log('   device B keys: curve25519=bobB-curve25519-CCCC')

  // Upload Alice's keys too
  await a.uploadKeys({
    device_keys: {
      user_id: a.userId,
      device_id: aliceDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${aliceDeviceId}`]: 'alice-curve25519-XXXX',
        [`ed25519:${aliceDeviceId}`]: 'alice-ed25519-YYYY',
      },
      signatures: {
        [a.userId]: { [`ed25519:${aliceDeviceId}`]: 'alice-sig' },
      },
    },
  })

  // 4. Alice queries Bob's devices — should see both
  console.log('\n4. Alice queries Bob\'s device keys...')
  const query = await a.queryKeys({ device_keys: { [bobA.userId]: [] } })
  const bobDevices = query.device_keys?.[bobA.userId] || {}
  const deviceIds = Object.keys(bobDevices)
  console.log(`   Bob's devices: [${deviceIds.join(', ')}]`)
  const hasDevA = deviceIds.includes(bobDevA)
  const hasDevB = deviceIds.includes(bobDevB)
  console.log(`   device A present: ${hasDevA}`)
  console.log(`   device B present: ${hasDevB}`)
  if (!hasDevA || !hasDevB) {
    console.log('   FAIL: not all devices found')
    pass = false
  }

  // Verify different identity keys
  const devAKey = bobDevices[bobDevA]?.keys?.[`curve25519:${bobDevA}`]
  const devBKey = bobDevices[bobDevB]?.keys?.[`curve25519:${bobDevB}`]
  console.log(`   device A curve25519: ${devAKey}`)
  console.log(`   device B curve25519: ${devBKey}`)
  if (devAKey === devBKey) {
    console.log('   FAIL: identity keys should differ')
    pass = false
  }

  // ================================================================
  // Phase 2: Alice shares room key to both devices
  // ================================================================

  console.log('\n=== Phase 2: Room key distribution ===')

  // 5. Both devices do initial sync
  console.log('\n5. Initial sync for both devices...')
  const syncA0 = await bobA.sync({ timeout: 0 })
  const syncB0 = await bobB.sync({ timeout: 0 })
  console.log(`   device A next_batch: ${syncA0.next_batch}`)
  console.log(`   device B next_batch: ${syncB0.next_batch}`)

  // 6. Alice sends m.room_key to EACH device with per-device encrypted payload
  //    (In real E2EE, each payload is encrypted with that device's Olm session)
  console.log('\n6. Alice sends m.room_key to both devices (per-device payload)...')
  const sessionId = `megolm-session-${Date.now()}`
  await a.sendToDevice('m.room_key', `txn-multi-${Date.now()}`, {
    [bobA.userId]: {
      [bobDevA]: {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!encrypted-room:example.com',
        session_id: sessionId,
        session_key: 'encrypted-for-devA-olm-payload',
        chain_index: 0,
        _note: 'This would be Olm-encrypted for device A\'s curve25519 key',
      },
      [bobDevB]: {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!encrypted-room:example.com',
        session_id: sessionId,
        session_key: 'encrypted-for-devB-olm-payload',
        chain_index: 0,
        _note: 'This would be Olm-encrypted for device B\'s curve25519 key',
      },
    },
  })
  console.log('   sent to both devices')

  // 7. Device A syncs — receives its copy of the room key
  console.log('\n7. Device A incremental sync...')
  const syncA1 = await bobA.sync({ since: syncA0.next_batch, timeout: 0 })
  const tdEventsA = syncA1.to_device?.events || []
  const roomKeyA = tdEventsA.find(
    (e: any) => e.type === 'm.room_key' && e.content.session_id === sessionId,
  )
  if (roomKeyA) {
    console.log(`   received session_key: ${roomKeyA.content.session_key}`)
    if (roomKeyA.content.session_key !== 'encrypted-for-devA-olm-payload') {
      console.log('   FAIL: device A got wrong payload')
      pass = false
    }
  }
  else {
    console.log('   FAIL: device A did not receive room key')
    pass = false
  }

  // 8. Device B syncs — receives its own copy
  console.log('\n8. Device B incremental sync...')
  const syncB1 = await bobB.sync({ since: syncB0.next_batch, timeout: 0 })
  const tdEventsB = syncB1.to_device?.events || []
  const roomKeyB = tdEventsB.find(
    (e: any) => e.type === 'm.room_key' && e.content.session_id === sessionId,
  )
  if (roomKeyB) {
    console.log(`   received session_key: ${roomKeyB.content.session_key}`)
    if (roomKeyB.content.session_key !== 'encrypted-for-devB-olm-payload') {
      console.log('   FAIL: device B got wrong payload')
      pass = false
    }
  }
  else {
    console.log('   FAIL: device B did not receive room key')
    pass = false
  }

  // 9. Verify both received the same session_id but different payloads
  console.log('\n9. Verifying per-device payloads...')
  if (roomKeyA && roomKeyB) {
    const sameSession = roomKeyA.content.session_id === roomKeyB.content.session_id
    const diffPayload = roomKeyA.content.session_key !== roomKeyB.content.session_key
    console.log(`   same session_id: ${sameSession}`)
    console.log(`   different payloads: ${diffPayload}`)
    if (!sameSession || !diffPayload) {
      console.log('   FAIL: expected same session_id, different Olm payloads')
      pass = false
    }
  }

  // ================================================================
  // Phase 3: Device A backs up keys via dehydrated device, then logs out
  // ================================================================

  console.log('\n=== Phase 3: Key backup via dehydrated device ===')

  // 10. Device A creates a dehydrated device to store its Megolm sessions
  //     The dehydrated device acts as a "ghost" device that holds keys for later import.
  console.log('\n10. Device A creates dehydrated device for key backup...')
  const dehydratedDeviceId = `dehydrated-${Date.now()}`
  await bobA.putDehydratedDevice({
    device_id: dehydratedDeviceId,
    device_data: {
      algorithm: 'org.matrix.msc3814.v1.olm',
      // In real implementation, this contains the encrypted Olm account
      // pickled with a key derived from the user's recovery passphrase
      account: 'pickled-olm-account-encrypted-with-recovery-key',
    },
    device_keys: {
      user_id: bobA.userId,
      device_id: dehydratedDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${dehydratedDeviceId}`]: 'dehydrated-curve25519-key',
        [`ed25519:${dehydratedDeviceId}`]: 'dehydrated-ed25519-key',
      },
      signatures: {
        [bobA.userId]: { [`ed25519:${dehydratedDeviceId}`]: 'dehydrated-sig' },
      },
    },
    initial_device_display_name: 'Key Backup Device',
  })
  console.log(`   dehydrated device: ${dehydratedDeviceId}`)

  // 11. Device A forwards its session keys to the dehydrated device via sendToDevice
  //     This is how real clients back up keys: send m.forwarded_room_key to the dehydrated device
  console.log('\n11. Device A forwards session keys to dehydrated device...')
  await bobA.sendToDevice('m.forwarded_room_key', `txn-backup-${Date.now()}`, {
    [bobA.userId]: {
      [dehydratedDeviceId]: {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!encrypted-room:example.com',
        session_id: sessionId,
        session_key: 'exported-megolm-session-key-from-devA',
        sender_key: 'alice-curve25519-XXXX',
        sender_claimed_ed25519_key: 'alice-ed25519-YYYY',
        forwarding_curve25519_key_chain: [],
        chain_index: 0,
      },
    },
  })

  // Also forward a second session
  const sessionId2 = `megolm-session-2-${Date.now()}`
  await bobA.sendToDevice('m.forwarded_room_key', `txn-backup2-${Date.now()}`, {
    [bobA.userId]: {
      [dehydratedDeviceId]: {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!another-room:example.com',
        session_id: sessionId2,
        session_key: 'exported-megolm-session-key-2',
        sender_key: 'alice-curve25519-XXXX',
        sender_claimed_ed25519_key: 'alice-ed25519-YYYY',
        forwarding_curve25519_key_chain: [],
        chain_index: 0,
      },
    },
  })
  console.log(`   forwarded 2 session keys (${sessionId}, ${sessionId2})`)

  // 12. Device A logs out
  console.log('\n12. Device A logs out...')
  await bobA.logout()
  console.log('   logged out')

  // ================================================================
  // Phase 4: Device B imports keys from the dehydrated device
  // ================================================================

  console.log('\n=== Phase 4: Device B imports keys ===')

  // 13. Device B discovers the dehydrated device
  console.log('\n13. Device B gets dehydrated device info...')
  const dehydrated = await bobB.getDehydratedDevice()
  console.log(`   device_id: ${dehydrated.device_id}`)
  console.log(`   algorithm: ${dehydrated.device_data.algorithm}`)
  if (dehydrated.device_id !== dehydratedDeviceId) {
    console.log('   FAIL: dehydrated device ID mismatch')
    pass = false
  }

  // 14. Device B retrieves to-device events sent to the dehydrated device
  //     These contain the forwarded room keys from device A
  console.log('\n14. Device B retrieves dehydrated device events...')
  const dehydratedEvents = await bobB.getDehydratedDeviceEvents(dehydratedDeviceId)
  const events = dehydratedEvents.events || []
  console.log(`   events count: ${events.length}`)

  const forwardedKeys = events.filter((e: any) => e.type === 'm.forwarded_room_key')
  console.log(`   forwarded_room_key events: ${forwardedKeys.length}`)

  if (forwardedKeys.length >= 2) {
    for (const fk of forwardedKeys) {
      console.log(`   - session: ${fk.content.session_id} room: ${fk.content.room_id}`)
    }

    const hasSession1 = forwardedKeys.some((e: any) => e.content.session_id === sessionId)
    const hasSession2 = forwardedKeys.some((e: any) => e.content.session_id === sessionId2)
    console.log(`   session 1 found: ${hasSession1}`)
    console.log(`   session 2 found: ${hasSession2}`)
    if (!hasSession1 || !hasSession2) {
      console.log('   FAIL: not all forwarded keys found')
      pass = false
    }
  }
  else {
    console.log(`   FAIL: expected at least 2 forwarded keys, got ${forwardedKeys.length}`)
    pass = false
  }

  // 15. Paginated retrieval with next_batch
  console.log('\n15. Paginated retrieval of dehydrated events...')
  const page1 = await bobB.getDehydratedDeviceEvents(dehydratedDeviceId, '0')
  console.log(`   page 1 events: ${page1.events.length}, next_batch: ${page1.next_batch}`)
  if (page1.events.length > 0) {
    const page2 = await bobB.getDehydratedDeviceEvents(dehydratedDeviceId, page1.next_batch)
    console.log(`   page 2 events: ${page2.events.length}, next_batch: ${page2.next_batch}`)
  }

  // 16. Device B deletes the dehydrated device after import
  console.log('\n16. Device B deletes dehydrated device...')
  const deleted = await bobB.deleteDehydratedDevice()
  console.log(`   deleted device: ${deleted.device_id}`)
  if (deleted.device_id !== dehydratedDeviceId) {
    console.log('   FAIL: deleted wrong device')
    pass = false
  }

  // 17. Verify dehydrated device is gone
  console.log('\n17. Verifying dehydrated device is deleted...')
  try {
    await bobB.getDehydratedDevice()
    console.log('   FAIL: dehydrated device still exists')
    pass = false
  }
  catch (err: any) {
    if (err.status === 404) {
      console.log('   correctly not found (404)')
    }
    else {
      console.log(`   unexpected error: ${err.status} ${err.message}`)
      pass = false
    }
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
