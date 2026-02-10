/**
 * 07-send-to-device: Simulate Megolm room key sharing via sendToDevice.
 *
 * Flow:
 *  1. Alice & Bob join a room, both upload device keys
 *  2. Bob claims Alice's OTK (Olm session bootstrap)
 *  3. Alice sends m.room_key to Bob via sendToDevice
 *  4. Bob syncs and verifies to-device message arrived
 *  5. Alice sends to wildcard device "*"
 *  6. Multiple to-device messages ordering test
 */

import { alice, bob, loadTokens } from './config'

async function main() {
  const tokens = await loadTokens()
  const a = await alice()
  const b = await bob()
  const aliceDeviceId = tokens.alice.deviceId
  const bobDeviceId = tokens.bob.deviceId

  console.log('--- 07-send-to-device ---')
  let pass = true

  // 0. Initial sync to get baseline positions
  console.log('\n0. Initial sync for both users...')
  const aliceSync0 = await a.sync({ timeout: 0 })
  const bobSync0 = await b.sync({ timeout: 0 })
  console.log(`   Alice next_batch: ${aliceSync0.next_batch}`)
  console.log(`   Bob next_batch: ${bobSync0.next_batch}`)

  // 1. Both upload device keys
  console.log('\n1. Uploading device keys...')
  await a.uploadKeys({
    device_keys: {
      user_id: a.userId,
      device_id: aliceDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${aliceDeviceId}`]: 'alice-curve25519-base64',
        [`ed25519:${aliceDeviceId}`]: 'alice-ed25519-base64',
      },
      signatures: {
        [a.userId]: { [`ed25519:${aliceDeviceId}`]: 'alice-sig-base64' },
      },
    },
    one_time_keys: {
      [`signed_curve25519:AAAAAQ`]: {
        key: 'alice-otk-1-base64',
        signatures: {
          [a.userId]: { [`ed25519:${aliceDeviceId}`]: 'alice-otk-sig-base64' },
        },
      },
    },
  })
  await b.uploadKeys({
    device_keys: {
      user_id: b.userId,
      device_id: bobDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDeviceId}`]: 'bob-curve25519-base64',
        [`ed25519:${bobDeviceId}`]: 'bob-ed25519-base64',
      },
      signatures: {
        [b.userId]: { [`ed25519:${bobDeviceId}`]: 'bob-sig-base64' },
      },
    },
  })
  console.log('   Alice & Bob device keys uploaded')

  // 2. Bob claims Alice's OTK (simulates Olm session bootstrap)
  console.log('\n2. Bob claims Alice\'s OTK...')
  const claim = await b.claimKeys({
    one_time_keys: { [a.userId]: { [aliceDeviceId]: 'signed_curve25519' } },
  })
  const claimed = claim.one_time_keys?.[a.userId]?.[aliceDeviceId]
  if (claimed) {
    console.log(`   claimed: ${Object.keys(claimed)[0]}`)
  }
  else {
    console.log('   FAIL: no OTK claimed')
    pass = false
  }

  // 3. Alice sends m.room_key to Bob's specific device
  console.log('\n3. Alice sends m.room_key to Bob (specific device)...')
  const roomKeyContent = {
    algorithm: 'm.megolm.v1.aes-sha2',
    room_id: '!fake-room:example.com',
    session_id: 'test-session-id-001',
    session_key: 'AgAAAABaaaaa...fake-megolm-session-key',
    chain_index: 0,
  }
  await a.sendToDevice('m.room_key', `txn-key-${Date.now()}`, {
    [b.userId]: {
      [bobDeviceId]: roomKeyContent,
    },
  })
  console.log('   sent')

  // 4. Bob syncs to receive to-device message
  console.log('\n4. Bob incremental sync...')
  const bobSync1 = await b.sync({ since: bobSync0.next_batch, timeout: 0 })
  const toDeviceEvents = bobSync1.to_device?.events || []
  console.log(`   to_device events: ${toDeviceEvents.length}`)

  const roomKeyEvent = toDeviceEvents.find(
    (e: any) => e.type === 'm.room_key' && e.content.session_id === 'test-session-id-001',
  )
  if (roomKeyEvent) {
    console.log(`   type: ${roomKeyEvent.type}`)
    console.log(`   sender: ${roomKeyEvent.sender}`)
    console.log(`   session_id: ${roomKeyEvent.content.session_id}`)
    console.log(`   algorithm: ${roomKeyEvent.content.algorithm}`)
  }
  else {
    console.log('   FAIL: m.room_key not found in to_device events')
    pass = false
  }

  // 5. Verify sender is Alice
  if (roomKeyEvent && roomKeyEvent.sender !== a.userId) {
    console.log(`   FAIL: sender mismatch — expected ${a.userId}, got ${roomKeyEvent.sender}`)
    pass = false
  }

  // 6. Alice sends m.room_key.withheld to Bob (key withholding)
  console.log('\n5. Alice sends m.room_key.withheld to Bob...')
  const withheldContent = {
    algorithm: 'm.megolm.v1.aes-sha2',
    room_id: '!fake-room:example.com',
    session_id: 'test-session-id-002',
    sender_key: 'alice-curve25519-base64',
    code: 'm.unverified',
    reason: 'Device not verified',
  }
  await a.sendToDevice('m.room_key.withheld', `txn-withheld-${Date.now()}`, {
    [b.userId]: {
      [bobDeviceId]: withheldContent,
    },
  })
  console.log('   sent')

  // 7. Bob syncs again to receive withheld event
  console.log('\n6. Bob incremental sync (withheld)...')
  const bobSync2 = await b.sync({ since: bobSync1.next_batch, timeout: 0 })
  const toDeviceEvents2 = bobSync2.to_device?.events || []
  console.log(`   to_device events: ${toDeviceEvents2.length}`)

  const withheldEvent = toDeviceEvents2.find(
    (e: any) => e.type === 'm.room_key.withheld' && e.content.session_id === 'test-session-id-002',
  )
  if (withheldEvent) {
    console.log(`   code: ${withheldEvent.content.code}`)
    console.log(`   reason: ${withheldEvent.content.reason}`)
  }
  else {
    console.log('   FAIL: m.room_key.withheld not found')
    pass = false
  }

  // 8. Wildcard device delivery: Alice sends to "*"
  console.log('\n7. Alice sends to wildcard device "*"...')
  await a.sendToDevice('m.room_key', `txn-wildcard-${Date.now()}`, {
    [b.userId]: {
      '*': {
        algorithm: 'm.megolm.v1.aes-sha2',
        room_id: '!fake-room:example.com',
        session_id: 'test-session-wildcard',
        session_key: 'AgAAAABbbbbb...fake-wildcard-key',
        chain_index: 0,
      },
    },
  })
  console.log('   sent')

  console.log('\n8. Bob incremental sync (wildcard)...')
  const bobSync3 = await b.sync({ since: bobSync2.next_batch, timeout: 0 })
  const toDeviceEvents3 = bobSync3.to_device?.events || []
  console.log(`   to_device events: ${toDeviceEvents3.length}`)

  const wildcardEvent = toDeviceEvents3.find(
    (e: any) => e.content.session_id === 'test-session-wildcard',
  )
  if (wildcardEvent) {
    console.log(`   session_id: ${wildcardEvent.content.session_id}`)
  }
  else {
    console.log('   FAIL: wildcard to-device message not received')
    pass = false
  }

  // 9. Ordering: send multiple to-device messages, verify order is preserved
  console.log('\n9. Ordering test: send 5 to-device messages...')
  for (let i = 1; i <= 5; i++) {
    await a.sendToDevice('m.room_key', `txn-order-${Date.now()}-${i}`, {
      [b.userId]: {
        [bobDeviceId]: {
          algorithm: 'm.megolm.v1.aes-sha2',
          room_id: '!fake-room:example.com',
          session_id: `order-test-${i}`,
          session_key: `key-${i}`,
          chain_index: i,
        },
      },
    })
  }
  console.log('   sent 5 messages')

  console.log('\n10. Bob incremental sync (ordering)...')
  const bobSync4 = await b.sync({ since: bobSync3.next_batch, timeout: 0 })
  const toDeviceEvents4 = bobSync4.to_device?.events || []
  const orderEvents = toDeviceEvents4.filter(
    (e: any) => e.content.session_id?.startsWith('order-test-'),
  )
  console.log(`   order events: ${orderEvents.length}`)

  if (orderEvents.length === 5) {
    const indices = orderEvents.map((e: any) => e.content.chain_index)
    const isOrdered = indices.every((v: number, i: number) => v === i + 1)
    console.log(`   chain_indices: [${indices.join(', ')}]`)
    console.log(`   correctly ordered: ${isOrdered}`)
    if (!isOrdered) {
      console.log('   FAIL: to-device messages not in order')
      pass = false
    }
  }
  else {
    console.log(`   FAIL: expected 5 order events, got ${orderEvents.length}`)
    pass = false
  }

  // 11. Verify consumed messages don't reappear on next sync
  console.log('\n11. Verify no re-delivery on next sync...')
  const bobSync5 = await b.sync({ since: bobSync4.next_batch, timeout: 0 })
  const toDeviceEvents5 = bobSync5.to_device?.events || []
  console.log(`   to_device events: ${toDeviceEvents5.length}`)
  if (toDeviceEvents5.length > 0) {
    console.log('   FAIL: to-device messages re-delivered after consumption')
    pass = false
  }
  else {
    console.log('   no re-delivery (correct)')
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
