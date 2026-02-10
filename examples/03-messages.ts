/**
 * 03-messages: Send, paginate, context, redact.
 */

import { alice } from './config'

async function main() {
  const a = await alice()

  console.log('--- 03-messages ---')
  let pass = true

  // 1. Create room
  console.log('\n1. Creating room...')
  const room = await a.createRoom({ name: 'Message Test Room' })
  const roomId = room.room_id
  console.log(`   room_id: ${roomId}`)

  // 2. Send multiple messages
  console.log('\n2. Sending 5 messages...')
  const eventIds: string[] = []
  for (let i = 1; i <= 5; i++) {
    const res = await a.sendMessage(roomId, `msg-${Date.now()}-${i}`, {
      msgtype: 'm.text',
      body: `Message #${i}`,
    })
    eventIds.push(res.event_id)
    console.log(`   sent: ${res.event_id} — "Message #${i}"`)
  }

  // 3. GET /messages backward
  console.log('\n3. Paginating backward (limit=3)...')
  const backward = await a.getMessages(roomId, { dir: 'b', limit: 3 })
  console.log(`   chunk length: ${backward.chunk.length}`)
  console.log(`   start: ${backward.start}, end: ${backward.end}`)
  if (backward.chunk.length === 0) {
    console.log('   FAIL: no messages returned')
    pass = false
  }

  // 4. GET /messages forward from the end token
  if (backward.end) {
    console.log('\n4. Paginating forward from end...')
    const forward = await a.getMessages(roomId, { from: backward.end, dir: 'f', limit: 10 })
    console.log(`   chunk length: ${forward.chunk.length}`)
  }

  // 5. GET single event
  console.log('\n5. Getting single event...')
  const singleEvent = await a.getEvent(roomId, eventIds[2]!)
  console.log(`   type: ${singleEvent.type}`)
  console.log(`   body: "${singleEvent.content.body}"`)
  if (singleEvent.content.body !== 'Message #3') {
    console.log('   FAIL: unexpected event content')
    pass = false
  }

  // 6. Redact a message
  console.log('\n6. Redacting message #4...')
  const redactResult = await a.redact(roomId, eventIds[3]!, `redact-${Date.now()}`, 'Test redaction')
  console.log(`   redaction event_id: ${redactResult.event_id}`)

  // 7. Verify redacted event content is empty
  console.log('\n7. Checking redacted event...')
  const redacted = await a.getEvent(roomId, eventIds[3]!)
  const contentKeys = Object.keys(redacted.content || {})
  console.log(`   content keys after redact: ${contentKeys.length}`)
  if (contentKeys.length > 0) {
    console.log('   FAIL: redacted event still has content')
    pass = false
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)

  // Cleanup
  await a.leaveRoom(roomId)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
