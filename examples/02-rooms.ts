/**
 * 02-rooms: Room lifecycle — create, invite, join, message, leave, members.
 */

import { alice, bob } from './config'

async function main() {
  const a = await alice()
  const b = await bob()

  console.log('--- 02-rooms ---')
  let pass = true

  // 1. Alice creates a room
  console.log('\n1. Alice creates room...')
  const room = await a.createRoom({
    name: 'Room Lifecycle Test',
    topic: 'Testing room lifecycle',
    preset: 'private_chat',
  })
  console.log(`   room_id: ${room.room_id}`)

  // 2. Alice invites Bob
  console.log('\n2. Alice invites Bob...')
  await a.invite(room.room_id, b.userId)
  console.log('   invite sent')

  // 3. Bob joins
  console.log('\n3. Bob joins...')
  await b.joinRoom(room.room_id)
  console.log('   joined')

  // 4. Both send messages
  console.log('\n4. Sending messages...')
  await a.sendMessage(room.room_id, `alice-msg-${Date.now()}`, {
    msgtype: 'm.text',
    body: 'Hello Bob!',
  })
  await b.sendMessage(room.room_id, `bob-msg-${Date.now()}`, {
    msgtype: 'm.text',
    body: 'Hello Alice!',
  })
  console.log('   both sent messages')

  // 5. Check members
  console.log('\n5. Checking members...')
  const members = await a.getMembers(room.room_id)
  const joined = members.chunk.filter((m: any) => m.content.membership === 'join')
  console.log(`   joined members: ${joined.length}`)
  if (joined.length !== 2) {
    console.log('   FAIL: expected 2 joined members')
    pass = false
  }

  // 6. Check joined rooms
  console.log('\n6. Checking joined_rooms...')
  const bobRooms = await b.joinedRooms()
  const bobInRoom = bobRooms.joined_rooms.includes(room.room_id)
  console.log(`   Bob is in room: ${bobInRoom}`)
  if (!bobInRoom) {
    console.log('   FAIL: Bob not found in joined_rooms')
    pass = false
  }

  // 7. Bob leaves
  console.log('\n7. Bob leaves...')
  await b.leaveRoom(room.room_id)
  console.log('   left')

  // 8. Verify Bob is no longer joined
  console.log('\n8. Checking members after leave...')
  const membersAfter = await a.getMembers(room.room_id)
  const joinedAfter = membersAfter.chunk.filter((m: any) => m.content.membership === 'join')
  console.log(`   joined members: ${joinedAfter.length}`)
  if (joinedAfter.length !== 1) {
    console.log('   FAIL: expected 1 joined member after leave')
    pass = false
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)

  // Cleanup
  await a.leaveRoom(room.room_id)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
