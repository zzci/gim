/**
 * 01-sync: Initial and incremental sync test.
 *
 * - Perform initial sync (no since)
 * - Send a message
 * - Incremental sync to verify the new event appears
 */

import { alice } from './config'

async function main() {
  const a = await alice()

  console.log('--- 01-sync ---')

  // 1. Initial sync
  console.log('\n1. Initial sync...')
  const initial = await a.sync({ timeout: 0 })
  console.log(`   next_batch: ${initial.next_batch}`)
  const joinedRooms = Object.keys(initial.rooms?.join || {})
  console.log(`   joined rooms: ${joinedRooms.length}`)

  // 2. Create a room to ensure we have something to sync
  console.log('\n2. Creating room for sync test...')
  const room = await a.createRoom({ name: 'Sync Test Room' })
  console.log(`   room_id: ${room.room_id}`)

  // 3. Send a message
  console.log('\n3. Sending message...')
  const txnId = `sync-test-${Date.now()}`
  const sent = await a.sendMessage(room.room_id, txnId, {
    msgtype: 'm.text',
    body: 'Hello from sync test!',
  })
  console.log(`   event_id: ${sent.event_id}`)

  // 4. Incremental sync
  console.log('\n4. Incremental sync...')
  const incremental = await a.sync({ since: initial.next_batch, timeout: 0 })
  console.log(`   next_batch: ${incremental.next_batch}`)

  const roomData = incremental.rooms?.join?.[room.room_id]
  const timelineEvents = roomData?.timeline?.events || []
  const messageEvents = timelineEvents.filter((e: any) => e.type === 'm.room.message')
  console.log(`   timeline events: ${timelineEvents.length}`)
  console.log(`   message events: ${messageEvents.length}`)

  if (messageEvents.length > 0) {
    console.log(`   last message: "${messageEvents[messageEvents.length - 1].content.body}"`)
  }

  // 5. Verify
  const found = messageEvents.some((e: any) => e.event_id === sent.event_id)
  console.log(`\n   RESULT: ${found ? 'PASS' : 'FAIL'} — sent event ${found ? 'found' : 'NOT found'} in incremental sync`)

  // Cleanup
  await a.leaveRoom(room.room_id)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
