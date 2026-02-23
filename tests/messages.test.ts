import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Messages', () => {
  test('send and retrieve a message', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Msg Test ${Date.now()}` })

    const sent = await a.sendMessage(room.room_id, txnId('msg'), {
      msgtype: 'm.text',
      body: 'Hello world',
    })
    expect(sent.event_id).toMatch(/^\$/)

    const fetched = await a.getEvent(room.room_id, sent.event_id)
    expect(fetched.type).toBe('m.room.message')
    expect(fetched.content.body).toBe('Hello world')
    expect(fetched.content.msgtype).toBe('m.text')
    expect(fetched.sender).toBe(a.userId)

    await a.leaveRoom(room.room_id)
  })

  test('paginate messages backward', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Page Test ${Date.now()}` })

    for (let i = 0; i < 5; i++) {
      await a.sendMessage(room.room_id, txnId(`page-${i}`), {
        msgtype: 'm.text',
        body: `Message #${i}`,
      })
    }

    const page = await a.getMessages(room.room_id, { dir: 'b', limit: 3 })
    expect(page.chunk.length).toBe(3)
    expect(page.start).toBeTruthy()
    expect(page.end).toBeTruthy()

    await a.leaveRoom(room.room_id)
  })

  test('paginate messages forward from token', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `FwdPage ${Date.now()}` })

    for (let i = 0; i < 5; i++) {
      await a.sendMessage(room.room_id, txnId(`fwd-${i}`), {
        msgtype: 'm.text',
        body: `Msg ${i}`,
      })
    }

    const backward = await a.getMessages(room.room_id, { dir: 'b', limit: 3 })
    const forward = await a.getMessages(room.room_id, { from: backward.end, dir: 'f', limit: 10 })
    expect(forward.chunk.length).toBeGreaterThan(0)

    await a.leaveRoom(room.room_id)
  })

  test('context returns surrounding events', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Context ${Date.now()}` })

    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const r = await a.sendMessage(room.room_id, txnId(`ctx-${i}`), {
        msgtype: 'm.text',
        body: `Context msg ${i}`,
      })
      ids.push(r.event_id)
    }

    const ctx = await a.getContext(room.room_id, ids[2]!, 10)
    expect(ctx.event).toBeDefined()
    expect(ctx.event.event_id).toBe(ids[2])
    expect(ctx.events_before.length).toBeGreaterThan(0)
    expect(ctx.events_after.length).toBeGreaterThan(0)
    expect(ctx.state.length).toBeGreaterThan(0)

    await a.leaveRoom(room.room_id)
  })

  test('non-member cannot read messages', async () => {
    const a = await getAlice()
    const b = await getBob()
    const room = await a.createRoom({ name: `NoAccess ${Date.now()}` })

    try {
      await b.getMessages(room.room_id, { dir: 'b', limit: 10 })
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    await a.leaveRoom(room.room_id)
  })
})

describe('Redaction', () => {
  test('redact own message strips content', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Redact Own ${Date.now()}` })

    const msg = await a.sendMessage(room.room_id, txnId('red'), {
      msgtype: 'm.text',
      body: 'Will be deleted',
    })

    const redact = await a.redact(room.room_id, msg.event_id, txnId('red-txn'), 'cleanup')
    expect(redact.event_id).toBeTruthy()

    const fetched = await a.getEvent(room.room_id, msg.event_id)
    expect(Object.keys(fetched.content)).toHaveLength(0)
    expect(fetched.unsigned?.redacted_because).toBeDefined()
    expect(fetched.unsigned.redacted_because.content.reason).toBe('cleanup')

    await a.leaveRoom(room.room_id)
  })

  test('room creator can redact others messages', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Redact Other ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const bobMsg = await b.sendMessage(room.room_id, txnId('bob-msg'), {
      msgtype: 'm.text',
      body: 'Bob\'s message',
    })

    // Alice (creator, power 100) can redact
    await a.redact(room.room_id, bobMsg.event_id, txnId('alice-red'))

    const fetched = await a.getEvent(room.room_id, bobMsg.event_id)
    expect(Object.keys(fetched.content)).toHaveLength(0)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('low power user cannot redact others messages', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Redact Perm ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const aliceMsg = await a.sendMessage(room.room_id, txnId('alice-msg'), {
      msgtype: 'm.text',
      body: 'Protected message',
    })

    try {
      await b.redact(room.room_id, aliceMsg.event_id, txnId('bob-red'))
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('self-redaction always works', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Self Redact ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const bobMsg = await b.sendMessage(room.room_id, txnId('bob-self'), {
      msgtype: 'm.text',
      body: 'Bob will delete this',
    })

    await b.redact(room.room_id, bobMsg.event_id, txnId('bob-self-red'))

    const fetched = await a.getEvent(room.room_id, bobMsg.event_id)
    expect(Object.keys(fetched.content)).toHaveLength(0)
    expect(fetched.unsigned?.redacted_because).toBeDefined()

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('redacted events appear in /messages with redacted_because', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Red Timeline ${Date.now()}` })

    const msg = await a.sendMessage(room.room_id, txnId('red-tl'), {
      msgtype: 'm.text',
      body: 'Timeline redact test',
    })
    await a.redact(room.room_id, msg.event_id, txnId('red-tl-txn'))

    const messages = await a.getMessages(room.room_id, { dir: 'b', limit: 20 })
    const redacted = messages.chunk.find((e: any) => e.event_id === msg.event_id)
    expect(redacted).toBeDefined()
    expect(redacted.unsigned?.redacted_because).toBeDefined()

    await a.leaveRoom(room.room_id)
  })

  test('redact nonexistent event returns 404', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Red 404 ${Date.now()}` })

    try {
      await a.redact(room.room_id, '$nonexistent:localhost', txnId('red-404'))
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(404)
    }

    await a.leaveRoom(room.room_id)
  })

  test('redact state event preserves membership keys', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Red State ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Find Bob's join event
    const members = await a.getMembers(room.room_id)
    const bobJoinEvent = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'join',
    )
    expect(bobJoinEvent).toBeDefined()

    // Redact the membership event — should preserve 'membership' key
    await a.redact(room.room_id, bobJoinEvent.event_id, txnId('red-state'))

    const fetched = await a.getEvent(room.room_id, bobJoinEvent.event_id)
    expect(fetched.content.membership).toBe('join')

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})

describe('Editing (m.replace)', () => {
  test('edit message updates content via getEvent', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Edit ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'Original',
    })

    await new Promise(r => setTimeout(r, 50))

    await a.editMessage(room.room_id, original.event_id, txnId('edit'), 'Edited')

    const fetched = await a.getEvent(room.room_id, original.event_id)
    expect(fetched.content.body).toBe('Edited')
    expect(fetched.unsigned?.['m.relations']?.['m.replace']).toBeDefined()

    await a.leaveRoom(room.room_id)
  })

  test('multiple edits — latest edit wins', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `MultiEdit ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'v1',
    })

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit1'), 'v2')

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit2'), 'v3')

    const fetched = await a.getEvent(room.room_id, original.event_id)
    expect(fetched.content.body).toBe('v3')

    await a.leaveRoom(room.room_id)
  })

  test('edited content appears in /messages', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `EditMsg ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'Before edit',
    })

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit'), 'After edit')

    const messages = await a.getMessages(room.room_id, { dir: 'b', limit: 20 })
    const found = messages.chunk.find((e: any) => e.event_id === original.event_id)
    expect(found).toBeDefined()
    expect(found.content.body).toBe('After edit')

    await a.leaveRoom(room.room_id)
  })

  test('edited content appears in /context', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `EditCtx ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'Original ctx',
    })

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit'), 'Edited ctx')

    const ctx = await a.getContext(room.room_id, original.event_id, 10)
    expect(ctx.event.content.body).toBe('Edited ctx')

    await a.leaveRoom(room.room_id)
  })

  test('edited content appears in sync', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `EditSync ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'Pre-edit sync',
    })

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit'), 'Post-edit sync')

    const sync = await a.sync()
    const roomData = sync.rooms.join[room.room_id]
    expect(roomData).toBeDefined()

    const origInSync = roomData.timeline.events.find((e: any) => e.event_id === original.event_id)
    if (origInSync) {
      expect(origInSync.content.body).toBe('Post-edit sync')
    }

    await a.leaveRoom(room.room_id)
  })

  test('redacting an edited message strips content', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `RedactEdit ${Date.now()}` })

    const original = await a.sendMessage(room.room_id, txnId('orig'), {
      msgtype: 'm.text',
      body: 'Will be edited then deleted',
    })

    await new Promise(r => setTimeout(r, 50))
    await a.editMessage(room.room_id, original.event_id, txnId('edit'), 'Edited version')

    await a.redact(room.room_id, original.event_id, txnId('red'))

    const fetched = await a.getEvent(room.room_id, original.event_id)
    expect(Object.keys(fetched.content)).toHaveLength(0)
    expect(fetched.unsigned?.redacted_because).toBeDefined()
    // Should NOT have m.relations after redaction
    expect(fetched.unsigned?.['m.relations']).toBeUndefined()

    await a.leaveRoom(room.room_id)
  })
})
