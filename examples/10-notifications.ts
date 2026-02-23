/**
 * 10-notifications: Push notification recording and GET /notifications endpoint.
 */

import { alice, bob } from './config'

async function main() {
  const a = await alice()
  const b = await bob()

  console.log('--- 10-notifications ---')
  let pass = true

  // 1. Alice creates a room and invites Bob
  console.log('\n1. Creating room and inviting Bob...')
  const room = await a.createRoom({ name: 'Notification Test', invite: [b.userId] })
  const roomId = room.room_id
  console.log(`   room_id: ${roomId}`)

  // 2. Bob joins the room
  console.log('\n2. Bob joins the room...')
  await b.joinRoom(roomId)

  // 3. Alice sends a normal message → Bob should get a notification
  console.log('\n3. Alice sends a normal message...')
  const msg1 = await a.sendMessage(roomId, `notif-${Date.now()}-1`, {
    msgtype: 'm.text',
    body: 'Hello Bob!',
  })
  console.log(`   event_id: ${msg1.event_id}`)

  // 4. Alice sends a message mentioning Bob via m.mentions → Bob should get a highlight notification
  console.log('\n4. Alice sends a mention message...')
  const msg2 = await a.sendMessage(roomId, `notif-${Date.now()}-2`, {
    'msgtype': 'm.text',
    'body': 'Hey Bob, check this out!',
    'm.mentions': { user_ids: [b.userId] },
  })
  console.log(`   event_id: ${msg2.event_id}`)

  // 5. GET /notifications for Bob — should have both notifications
  console.log('\n5. Bob fetches notifications...')
  const notifs = await b.getNotifications()
  console.log(`   count: ${notifs.notifications.length}`)
  if (notifs.notifications.length < 2) {
    console.log(`   FAIL: expected at least 2 notifications, got ${notifs.notifications.length}`)
    pass = false
  }
  else {
    console.log('   OK: got at least 2 notifications')
  }

  // Verify notification structure
  const firstNotif = notifs.notifications[0]
  if (!firstNotif.event || !firstNotif.actions || firstNotif.room_id !== roomId || firstNotif.ts === undefined) {
    console.log('   FAIL: notification missing required fields')
    pass = false
  }
  else {
    console.log('   OK: notification has correct structure')
  }

  // 6. GET /notifications?only=highlight → should only return mention notification
  console.log('\n6. Bob fetches highlight-only notifications...')
  const highlights = await b.getNotifications({ only: 'highlight' })
  console.log(`   highlight count: ${highlights.notifications.length}`)
  if (highlights.notifications.length < 1) {
    console.log('   FAIL: expected at least 1 highlight notification')
    pass = false
  }
  else {
    // Verify the highlight notification is the mention
    const hlNotif = highlights.notifications.find((n: any) => n.event.event_id === msg2.event_id)
    if (hlNotif) {
      console.log('   OK: highlight notification is the mention')
    }
    else {
      console.log('   FAIL: mention event not found in highlight notifications')
      pass = false
    }
  }

  // 7. Bob sends a read receipt → read status should update
  console.log('\n7. Bob sends read receipt...')
  await b.sendReceipt(roomId, msg2.event_id)
  const afterRead = await b.getNotifications()
  const readNotifs = afterRead.notifications.filter((n: any) => n.read === true && n.room_id === roomId)
  console.log(`   read notifications: ${readNotifs.length}`)
  if (readNotifs.length >= 2) {
    console.log('   OK: notifications marked as read')
  }
  else {
    console.log(`   WARN: expected at least 2 read notifications, got ${readNotifs.length}`)
  }

  // 8. Pagination test: send more messages, then paginate
  console.log('\n8. Pagination test...')
  for (let i = 0; i < 5; i++) {
    await a.sendMessage(roomId, `notif-page-${Date.now()}-${i}`, {
      msgtype: 'm.text',
      body: `Paginated message #${i}`,
    })
  }

  const page1 = await b.getNotifications({ limit: 3 })
  console.log(`   page 1: ${page1.notifications.length} notifications`)
  if (page1.notifications.length !== 3) {
    console.log(`   FAIL: expected 3 notifications on page 1, got ${page1.notifications.length}`)
    pass = false
  }

  if (page1.next_token) {
    const page2 = await b.getNotifications({ from: page1.next_token, limit: 3 })
    console.log(`   page 2: ${page2.notifications.length} notifications (from=${page1.next_token})`)
    if (page2.notifications.length === 0) {
      console.log('   FAIL: page 2 returned no notifications')
      pass = false
    }
    else {
      console.log('   OK: pagination works')
    }
  }
  else {
    console.log('   FAIL: no next_token returned')
    pass = false
  }

  // 9. Alice should NOT have notifications for her own messages
  console.log('\n9. Alice checks her own notifications...')
  const aliceNotifs = await a.getNotifications()
  const aliceSelfNotifs = aliceNotifs.notifications.filter((n: any) => n.event.sender === a.userId && n.room_id === roomId)
  if (aliceSelfNotifs.length === 0) {
    console.log('   OK: Alice has no self-notifications')
  }
  else {
    console.log(`   FAIL: Alice has ${aliceSelfNotifs.length} self-notifications`)
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
