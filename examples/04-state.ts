/**
 * 04-state: State events, room aliases, user profile.
 */

import { alice, SERVER_NAME } from './config'

async function main() {
  const a = await alice()

  console.log('--- 04-state ---')
  let pass = true

  // 1. Create room
  console.log('\n1. Creating room...')
  const room = await a.createRoom({ name: 'State Test' })
  const roomId = room.room_id
  console.log(`   room_id: ${roomId}`)

  // 2. Set room name
  console.log('\n2. Setting room name...')
  await a.sendStateEvent(roomId, 'm.room.name', '', { name: 'Updated Room Name' })
  const nameState = await a.getStateEvent(roomId, 'm.room.name', '')
  console.log(`   room name: "${nameState.name}"`)
  if (nameState.name !== 'Updated Room Name') {
    console.log('   FAIL: name mismatch')
    pass = false
  }

  // 3. Set room topic
  console.log('\n3. Setting room topic...')
  await a.sendStateEvent(roomId, 'm.room.topic', '', { topic: 'Testing state events' })
  const topicState = await a.getStateEvent(roomId, 'm.room.topic', '')
  console.log(`   room topic: "${topicState.topic}"`)
  if (topicState.topic !== 'Testing state events') {
    console.log('   FAIL: topic mismatch')
    pass = false
  }

  // 4. Create room alias
  const alias = `#state-test-${Date.now()}:${SERVER_NAME}`
  console.log(`\n4. Creating alias ${alias}...`)
  await a.createAlias(alias, roomId)
  console.log('   alias created')

  // 5. Resolve alias
  console.log('\n5. Resolving alias...')
  const resolved = await a.resolveAlias(alias)
  console.log(`   resolved room_id: ${resolved.room_id}`)
  if (resolved.room_id !== roomId) {
    console.log('   FAIL: alias resolved to wrong room')
    pass = false
  }

  // 6. Delete alias
  console.log('\n6. Deleting alias...')
  await a.deleteAlias(alias)
  console.log('   alias deleted')

  // 7. Verify alias no longer resolves
  console.log('\n7. Verifying alias is gone...')
  try {
    await a.resolveAlias(alias)
    console.log('   FAIL: alias still resolves after deletion')
    pass = false
  }
  catch (err: any) {
    if (err.status === 404) {
      console.log('   alias correctly not found (404)')
    }
    else {
      console.log(`   unexpected error: ${err.message}`)
      pass = false
    }
  }

  // 8. Update displayname
  console.log('\n8. Updating displayname...')
  await a.setDisplayName(a.userId, 'Alice Wonderland')
  const profile = await a.getProfile(a.userId)
  console.log(`   displayname: "${profile.displayname}"`)
  if (profile.displayname !== 'Alice Wonderland') {
    console.log('   FAIL: displayname mismatch')
    pass = false
  }

  // 9. Update avatar
  console.log('\n9. Updating avatar_url...')
  await a.setAvatarUrl(a.userId, 'mxc://localhost/test-avatar')
  const profile2 = await a.getProfile(a.userId)
  console.log(`   avatar_url: "${profile2.avatar_url}"`)
  if (profile2.avatar_url !== 'mxc://localhost/test-avatar') {
    console.log('   FAIL: avatar_url mismatch')
    pass = false
  }

  // Restore displayname
  await a.setDisplayName(a.userId, 'Alice')

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)

  // Cleanup
  await a.leaveRoom(roomId)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
