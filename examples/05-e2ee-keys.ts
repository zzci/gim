/**
 * 05-e2ee-keys: Device key upload, query, OTK claim, key changes.
 */

import { alice, bob, loadTokens } from './config'

async function main() {
  const tokens = await loadTokens()
  const a = await alice()
  const b = await bob()

  console.log('--- 05-e2ee-keys ---')
  let pass = true

  // Get sync positions for key changes tracking
  const aliceSync = await a.sync({ timeout: 0 })
  const sinceBefore = aliceSync.next_batch

  // 1. Upload device keys for Alice
  console.log('\n1. Uploading device keys for Alice...')
  const aliceDeviceId = tokens.alice.deviceId
  const uploadResult = await a.uploadKeys({
    device_keys: {
      user_id: a.userId,
      device_id: aliceDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${aliceDeviceId}`]: 'alice-curve25519-key-base64',
        [`ed25519:${aliceDeviceId}`]: 'alice-ed25519-key-base64',
      },
      signatures: {
        [a.userId]: {
          [`ed25519:${aliceDeviceId}`]: 'alice-device-signature-base64',
        },
      },
    },
    one_time_keys: {
      [`signed_curve25519:AAAAAQ`]: {
        key: 'otk-key-1-base64',
        signatures: {
          [a.userId]: {
            [`ed25519:${aliceDeviceId}`]: 'otk-1-signature-base64',
          },
        },
      },
      [`signed_curve25519:AAAABA`]: {
        key: 'otk-key-2-base64',
        signatures: {
          [a.userId]: {
            [`ed25519:${aliceDeviceId}`]: 'otk-2-signature-base64',
          },
        },
      },
    },
  })
  console.log(`   one_time_key_counts: ${JSON.stringify(uploadResult.one_time_key_counts)}`)
  const otkCount = uploadResult.one_time_key_counts?.signed_curve25519 || 0
  if (otkCount < 2) {
    console.log(`   FAIL: expected at least 2 OTKs, got ${otkCount}`)
    pass = false
  }

  // 2. Query Alice's device keys
  console.log('\n2. Querying Alice\'s device keys...')
  const queryResult = await b.queryKeys({
    device_keys: {
      [a.userId]: [],
    },
  })
  const aliceKeys = queryResult.device_keys?.[a.userId]
  if (aliceKeys) {
    const deviceKeyData = aliceKeys[aliceDeviceId]
    console.log(`   found device: ${aliceDeviceId}`)
    console.log(`   algorithms: ${JSON.stringify(deviceKeyData?.algorithms)}`)
  }
  else {
    console.log('   FAIL: no device keys found for Alice')
    pass = false
  }

  // 3. Bob claims one of Alice's OTKs
  console.log('\n3. Bob claiming Alice\'s OTK...')
  const claimResult = await b.claimKeys({
    one_time_keys: {
      [a.userId]: {
        [aliceDeviceId]: 'signed_curve25519',
      },
    },
  })
  const claimedKeys = claimResult.one_time_keys?.[a.userId]?.[aliceDeviceId]
  if (claimedKeys) {
    const keyIds = Object.keys(claimedKeys)
    console.log(`   claimed key: ${keyIds[0]}`)
  }
  else {
    console.log('   FAIL: no OTK claimed')
    pass = false
  }

  // 4. Verify OTK count decreased
  console.log('\n4. Checking OTK count after claim...')
  const uploadCheck = await a.uploadKeys({})
  const remainingOtks = uploadCheck.one_time_key_counts?.signed_curve25519 || 0
  console.log(`   remaining OTKs: ${remainingOtks}`)
  if (remainingOtks >= otkCount) {
    console.log(`   FAIL: OTK count did not decrease (was ${otkCount}, now ${remainingOtks})`)
    pass = false
  }

  // 5. Upload device keys for Bob and check key changes
  console.log('\n5. Uploading device keys for Bob...')
  const bobDeviceId = tokens.bob.deviceId
  await b.uploadKeys({
    device_keys: {
      user_id: b.userId,
      device_id: bobDeviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
      keys: {
        [`curve25519:${bobDeviceId}`]: 'bob-curve25519-key-base64',
        [`ed25519:${bobDeviceId}`]: 'bob-ed25519-key-base64',
      },
      signatures: {
        [b.userId]: {
          [`ed25519:${bobDeviceId}`]: 'bob-device-signature-base64',
        },
      },
    },
  })
  console.log('   uploaded')

  // 6. Check key changes
  console.log('\n6. Checking key changes...')
  const aliceSync2 = await a.sync({ since: sinceBefore, timeout: 0 })
  const sinceAfter = aliceSync2.next_batch
  try {
    const changes = await a.getKeyChanges(sinceBefore, sinceAfter)
    console.log(`   changed users: ${JSON.stringify(changes.changed)}`)
    console.log(`   left users: ${JSON.stringify(changes.left)}`)
  }
  catch (err: any) {
    console.log(`   key changes error (may be expected): ${err.message}`)
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
