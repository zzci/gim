/**
 * 11-redact-and-edit: Test message redaction (deletion) and editing (m.replace).
 */

import { alice, bob } from './config'

async function main() {
  const a = await alice()
  const b = await bob()

  console.log('--- 11-redact-and-edit ---')
  let pass = true

  // 1. Create room with Alice and Bob
  console.log('\n1. Creating room...')
  const room = await a.createRoom({ name: 'Redact & Edit Test', invite: [b.userId] })
  const roomId = room.room_id
  await b.joinRoom(roomId)
  console.log(`   room_id: ${roomId}`)

  // ===================== REDACTION TESTS =====================

  // 2. Send a message then redact it
  console.log('\n--- REDACTION ---')
  console.log('\n2. Alice sends a message, then redacts it...')
  const msg1 = await a.sendMessage(roomId, `red-${Date.now()}-1`, {
    msgtype: 'm.text',
    body: 'This message will be deleted',
  })
  console.log(`   sent: ${msg1.event_id}`)

  const redactResult = await a.redact(roomId, msg1.event_id, `red-txn-${Date.now()}`, 'Testing redaction')
  console.log(`   redaction event: ${redactResult.event_id}`)

  // 3. Verify the redacted event has empty content
  console.log('\n3. Verify redacted event content is stripped...')
  const redacted = await a.getEvent(roomId, msg1.event_id)
  const contentKeys = Object.keys(redacted.content || {})
  if (contentKeys.length > 0) {
    console.log(`   FAIL: redacted event still has content keys: ${contentKeys.join(', ')}`)
    pass = false
  }
  else {
    console.log('   OK: content is empty')
  }

  // 4. Verify unsigned.redacted_because exists
  if (redacted.unsigned?.redacted_because) {
    console.log(`   OK: unsigned.redacted_because present (event: ${redacted.unsigned.redacted_because.event_id})`)
    if (redacted.unsigned.redacted_because.content?.reason === 'Testing redaction') {
      console.log('   OK: redaction reason preserved')
    }
    else {
      console.log('   FAIL: redaction reason missing')
      pass = false
    }
  }
  else {
    console.log('   FAIL: unsigned.redacted_because missing')
    pass = false
  }

  // 5. Bob sends a message, Alice tries to redact (should fail — not sender and default power)
  console.log('\n5. Permission check: Bob sends a message, Alice tries to redact...')
  const bobMsg = await b.sendMessage(roomId, `red-bob-${Date.now()}`, {
    msgtype: 'm.text',
    body: 'Bob\'s message',
  })
  console.log(`   Bob sent: ${bobMsg.event_id}`)

  // Alice is the room creator (power 100), so she CAN redact Bob's message
  const aliceRedact = await a.redact(roomId, bobMsg.event_id, `red-alice-${Date.now()}`, 'Admin redaction')
  console.log(`   Alice redacted Bob's message: ${aliceRedact.event_id}`)
  const bobRedacted = await a.getEvent(roomId, bobMsg.event_id)
  if (Object.keys(bobRedacted.content || {}).length === 0) {
    console.log('   OK: room creator can redact other users\' messages')
  }
  else {
    console.log('   FAIL: redaction by room creator did not work')
    pass = false
  }

  // 6. Bob tries to redact Alice's message (should fail — not sender and low power)
  console.log('\n6. Bob tries to redact Alice\'s message (should fail)...')
  const aliceMsg = await a.sendMessage(roomId, `red-alice-msg-${Date.now()}`, {
    msgtype: 'm.text',
    body: 'Alice\'s protected message',
  })
  try {
    await b.redact(roomId, aliceMsg.event_id, `red-bob-try-${Date.now()}`)
    console.log('   FAIL: Bob was able to redact Alice\'s message')
    pass = false
  }
  catch (err: any) {
    if (err.status === 403) {
      console.log('   OK: 403 Forbidden — insufficient power level')
    }
    else {
      console.log(`   FAIL: unexpected error: ${err.message}`)
      pass = false
    }
  }

  // 7. Bob redacts his own message (self-redaction should work)
  console.log('\n7. Bob redacts his own message...')
  const bobMsg2 = await b.sendMessage(roomId, `red-bob2-${Date.now()}`, {
    msgtype: 'm.text',
    body: 'Bob will delete this',
  })
  const bobSelfRedact = await b.redact(roomId, bobMsg2.event_id, `red-bob-self-${Date.now()}`)
  console.log(`   Bob self-redacted: ${bobSelfRedact.event_id}`)
  const bobSelfRedacted = await a.getEvent(roomId, bobMsg2.event_id)
  if (Object.keys(bobSelfRedacted.content || {}).length === 0) {
    console.log('   OK: self-redaction works')
  }
  else {
    console.log('   FAIL: self-redaction did not clear content')
    pass = false
  }

  // 8. Redacted events appear correctly in /messages
  console.log('\n8. Check redacted events in /messages...')
  const messages = await a.getMessages(roomId, { dir: 'b', limit: 20 })
  const redactedInTimeline = messages.chunk.filter((e: any) => e.unsigned?.redacted_because)
  console.log(`   redacted events in timeline: ${redactedInTimeline.length}`)
  if (redactedInTimeline.length >= 3) {
    console.log('   OK: redacted events visible with redacted_because')
  }
  else {
    console.log(`   WARN: expected >= 3 redacted events, got ${redactedInTimeline.length}`)
  }

  // ===================== EDITING TESTS =====================

  console.log('\n--- EDITING ---')

  // 9. Send a message, then edit it
  console.log('\n9. Alice sends a message and edits it...')
  const original = await a.sendMessage(roomId, `edit-${Date.now()}-1`, {
    msgtype: 'm.text',
    body: 'Original message',
  })
  console.log(`   original: ${original.event_id}`)

  await new Promise(r => setTimeout(r, 50))

  const edit = await a.editMessage(roomId, original.event_id, `edit-txn-${Date.now()}`, 'Edited message')
  console.log(`   edit event: ${edit.event_id}`)

  // 10. Fetch the original event — should have edited content
  console.log('\n10. Fetch original event — should reflect edit...')
  const fetched = await a.getEvent(roomId, original.event_id)
  if (fetched.content?.body === 'Edited message') {
    console.log('   OK: content.body updated to "Edited message"')
  }
  else {
    console.log(`   FAIL: content.body = "${fetched.content?.body}" (expected "Edited message")`)
    pass = false
  }

  if (fetched.unsigned?.['m.relations']?.['m.replace']) {
    console.log(`   OK: unsigned.m.relations.m.replace present (event: ${fetched.unsigned['m.relations']['m.replace'].event_id})`)
  }
  else {
    console.log('   FAIL: unsigned.m.relations.m.replace missing')
    pass = false
  }

  // 11. Edit the same message again — latest edit should win
  console.log('\n11. Edit the same message a second time...')
  await new Promise(r => setTimeout(r, 50))
  const edit2 = await a.editMessage(roomId, original.event_id, `edit-txn2-${Date.now()}`, 'Second edit')
  console.log(`   edit2 event: ${edit2.event_id}`)

  const fetched2 = await a.getEvent(roomId, original.event_id)
  if (fetched2.content?.body === 'Second edit') {
    console.log('   OK: latest edit wins — content.body = "Second edit"')
  }
  else {
    console.log(`   FAIL: content.body = "${fetched2.content?.body}" (expected "Second edit")`)
    pass = false
  }

  // 12. Edited events in /messages
  console.log('\n12. Check edited events in /messages...')
  const msgs2 = await a.getMessages(roomId, { dir: 'b', limit: 20 })
  const originalInTimeline = msgs2.chunk.find((e: any) => e.event_id === original.event_id)
  if (originalInTimeline) {
    if (originalInTimeline.content?.body === 'Second edit') {
      console.log('   OK: original event in /messages has edited content')
    }
    else {
      console.log(`   FAIL: content.body in /messages = "${originalInTimeline.content?.body}"`)
      pass = false
    }
  }
  else {
    console.log('   WARN: original event not found in /messages response')
  }

  // 13. Edited events in sync
  console.log('\n13. Check edited events in sync...')
  const syncRes = await a.sync()
  const roomData = syncRes.rooms?.join?.[roomId]
  if (roomData) {
    const origInSync = roomData.timeline.events.find((e: any) => e.event_id === original.event_id)
    if (origInSync) {
      if (origInSync.content?.body === 'Second edit') {
        console.log('   OK: original event in sync has edited content')
      }
      else {
        console.log(`   FAIL: content.body in sync = "${origInSync.content?.body}"`)
        pass = false
      }
    }
    else {
      console.log('   INFO: original event not in sync timeline (may be paged out)')
    }
  }
  else {
    console.log('   WARN: room not in sync response')
  }

  // 14. Edited events in /context
  console.log('\n14. Check edited events in /context...')
  const ctx = await a.getContext(roomId, original.event_id, 10)
  if (ctx.event?.content?.body === 'Second edit') {
    console.log('   OK: /context returns edited content')
  }
  else {
    console.log(`   FAIL: /context content.body = "${ctx.event?.content?.body}"`)
    pass = false
  }

  // 15. Redact an edited message — should strip both original content and relations
  console.log('\n15. Redact the edited message...')
  await a.redact(roomId, original.event_id, `red-edited-${Date.now()}`)
  const redactedEdit = await a.getEvent(roomId, original.event_id)
  if (Object.keys(redactedEdit.content || {}).length === 0) {
    console.log('   OK: redacted edited event has empty content')
  }
  else {
    console.log('   FAIL: redacted edited event still has content')
    pass = false
  }
  if (redactedEdit.unsigned?.redacted_because) {
    console.log('   OK: unsigned.redacted_because present')
  }
  else {
    console.log('   FAIL: unsigned.redacted_because missing')
    pass = false
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)

  // Cleanup
  await a.leaveRoom(roomId)
  await b.leaveRoom(roomId)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
