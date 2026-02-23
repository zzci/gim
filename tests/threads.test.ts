import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Threads (MSC3440)', () => {
  test('thread replies create a thread and appear in /threads listing', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Thread Test ${Date.now()}` })

    // Send a root message
    const root = await a.sendMessage(room.room_id, txnId('root'), {
      msgtype: 'm.text',
      body: 'Thread root message',
    })

    // Send 3 thread replies
    for (let i = 0; i < 3; i++) {
      await a.sendThreadReply(room.room_id, root.event_id, txnId(`reply-${i}`), `Reply #${i}`)
    }

    // GET /threads should list the root with thread summary
    const threads = await a.getThreadRoots(room.room_id)
    expect(threads.chunk.length).toBe(1)
    expect(threads.chunk[0].event_id).toBe(root.event_id)

    const summary = threads.chunk[0].unsigned?.['m.relations']?.['m.thread']
    expect(summary).toBeDefined()
    expect(summary.count).toBe(3)
    expect(summary.latest_event).toBeDefined()
    expect(summary.latest_event.content.body).toBe('Reply #2')
    expect(summary.current_user_participated).toBe(true)

    await a.leaveRoom(room.room_id)
  })

  test('latest_event in summary is the most recent reply', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Thread Latest ${Date.now()}` })

    const root = await a.sendMessage(room.room_id, txnId('root'), {
      msgtype: 'm.text',
      body: 'Root',
    })

    await a.sendThreadReply(room.room_id, root.event_id, txnId('r1'), 'First reply')
    await a.sendThreadReply(room.room_id, root.event_id, txnId('r2'), 'Second reply')
    const last = await a.sendThreadReply(room.room_id, root.event_id, txnId('r3'), 'Last reply')

    const threads = await a.getThreadRoots(room.room_id)
    const summary = threads.chunk[0].unsigned['m.relations']['m.thread']
    expect(summary.latest_event.event_id).toBe(last.event_id)
    expect(summary.latest_event.content.body).toBe('Last reply')

    await a.leaveRoom(room.room_id)
  })

  test('pagination with limit and next_batch', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Thread Page ${Date.now()}` })

    // Create 3 threads
    const roots: string[] = []
    for (let i = 0; i < 3; i++) {
      const root = await a.sendMessage(room.room_id, txnId(`root-${i}`), {
        msgtype: 'm.text',
        body: `Root ${i}`,
      })
      roots.push(root.event_id)
      await a.sendThreadReply(room.room_id, root.event_id, txnId(`reply-${i}`), `Reply to root ${i}`)
    }

    // Get first page with limit=1
    const page1 = await a.getThreadRoots(room.room_id, { limit: 1 })
    expect(page1.chunk.length).toBe(1)
    expect(page1.next_batch).toBeDefined()

    // Get second page
    const page2 = await a.getThreadRoots(room.room_id, { limit: 1, from: page1.next_batch })
    expect(page2.chunk.length).toBe(1)
    expect(page2.chunk[0].event_id).not.toBe(page1.chunk[0].event_id)

    // Get third page
    const page3 = await a.getThreadRoots(room.room_id, { limit: 1, from: page2.next_batch })
    expect(page3.chunk.length).toBe(1)

    // Fourth page should be empty
    if (page3.next_batch) {
      const page4 = await a.getThreadRoots(room.room_id, { limit: 1, from: page3.next_batch })
      expect(page4.chunk.length).toBe(0)
    }

    await a.leaveRoom(room.room_id)
  })

  test('include=participated filters to threads user replied in', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Thread Participated ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Alice creates two thread roots
    const root1 = await a.sendMessage(room.room_id, txnId('root1'), {
      msgtype: 'm.text',
      body: 'Root 1',
    })
    const root2 = await a.sendMessage(room.room_id, txnId('root2'), {
      msgtype: 'm.text',
      body: 'Root 2',
    })

    // Alice replies to root1
    await a.sendThreadReply(room.room_id, root1.event_id, txnId('a-reply1'), 'Alice reply to root1')

    // Bob replies to root2 only
    await b.sendThreadReply(room.room_id, root2.event_id, txnId('b-reply2'), 'Bob reply to root2')

    // Bob with participated should only see root2
    const bobParticipated = await b.getThreadRoots(room.room_id, { include: 'participated' })
    expect(bobParticipated.chunk.length).toBe(1)
    expect(bobParticipated.chunk[0].event_id).toBe(root2.event_id)

    // Bob with all should see both
    const bobAll = await b.getThreadRoots(room.room_id, { include: 'all' })
    expect(bobAll.chunk.length).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('thread replies appear in normal room timeline', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Thread Timeline ${Date.now()}` })

    const root = await a.sendMessage(room.room_id, txnId('root'), {
      msgtype: 'm.text',
      body: 'Thread root',
    })

    const reply = await a.sendThreadReply(room.room_id, root.event_id, txnId('reply'), 'Thread reply')

    // Both root and reply should appear in /messages
    const messages = await a.getMessages(room.room_id, { dir: 'b', limit: 20 })
    const rootInTimeline = messages.chunk.find((e: any) => e.event_id === root.event_id)
    const replyInTimeline = messages.chunk.find((e: any) => e.event_id === reply.event_id)

    expect(rootInTimeline).toBeDefined()
    expect(replyInTimeline).toBeDefined()
    expect(replyInTimeline.content['m.relates_to'].rel_type).toBe('m.thread')

    await a.leaveRoom(room.room_id)
  })

  test('non-member cannot list threads', async () => {
    const a = await getAlice()
    const b = await getBob()
    const room = await a.createRoom({ name: `Thread NoAccess ${Date.now()}` })

    try {
      await b.getThreadRoots(room.room_id)
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    await a.leaveRoom(room.room_id)
  })

  test('room with no threads returns empty chunk', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `No Threads ${Date.now()}` })

    const threads = await a.getThreadRoots(room.room_id)
    expect(threads.chunk).toEqual([])
    expect(threads.next_batch).toBeUndefined()

    await a.leaveRoom(room.room_id)
  })

  test('thread summary appears in getEvent for root event', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Thread GetEvent ${Date.now()}` })

    const root = await a.sendMessage(room.room_id, txnId('root'), {
      msgtype: 'm.text',
      body: 'Root for getEvent test',
    })

    await a.sendThreadReply(room.room_id, root.event_id, txnId('r1'), 'Reply 1')
    await a.sendThreadReply(room.room_id, root.event_id, txnId('r2'), 'Reply 2')

    // GET /event/:eventId should include thread summary in unsigned
    const fetched = await a.getEvent(room.room_id, root.event_id)
    const threadRelation = fetched.unsigned?.['m.relations']?.['m.thread']
    expect(threadRelation).toBeDefined()
    expect(threadRelation.count).toBe(2)
    expect(threadRelation.latest_event).toBeDefined()

    await a.leaveRoom(room.room_id)
  })
})
