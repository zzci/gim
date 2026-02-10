import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

describe('Rooms', () => {
  test('create room returns room_id', async () => {
    const a = await getAlice()
    const res = await a.createRoom({ name: `Room Create ${Date.now()}` })
    expect(res.room_id).toMatch(/^!/)
    await a.leaveRoom(res.room_id)
  })

  test('create room with topic and preset', async () => {
    const a = await getAlice()
    const res = await a.createRoom({
      name: 'Test Room',
      topic: 'Test Topic',
      preset: 'private_chat',
    })
    expect(res.room_id).toBeTruthy()

    // Verify state was set
    const name = await a.getStateEvent(res.room_id, 'm.room.name')
    expect(name.name).toBe('Test Room')

    const topic = await a.getStateEvent(res.room_id, 'm.room.topic')
    expect(topic.topic).toBe('Test Topic')

    await a.leaveRoom(res.room_id)
  })

  test('invite and join flow', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Invite Join ${Date.now()}` })
    await a.invite(room.room_id, b.userId)
    await b.joinRoom(room.room_id)

    const members = await a.getMembers(room.room_id)
    const joined = members.chunk.filter((e: any) => e.content.membership === 'join')
    expect(joined.length).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('create room with invite list', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Auto Invite ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const joined = await b.joinedRooms()
    expect(joined.joined_rooms).toContain(room.room_id)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('leave room removes from joined_rooms', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Leave Test ${Date.now()}` })

    let joined = await a.joinedRooms()
    expect(joined.joined_rooms).toContain(room.room_id)

    await a.leaveRoom(room.room_id)

    joined = await a.joinedRooms()
    expect(joined.joined_rooms).not.toContain(room.room_id)
  })

  test('kick removes user from room', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Kick Test ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    await a.kick(room.room_id, b.userId, 'test kick')

    const members = await a.getMembers(room.room_id)
    const bobMember = members.chunk.find((e: any) => e.state_key === b.userId)
    expect(bobMember.content.membership).toBe('leave')

    await a.leaveRoom(room.room_id)
  })

  test('ban prevents rejoin', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Ban Test ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)
    await a.ban(room.room_id, b.userId, 'test ban')

    // Bob cannot rejoin
    try {
      await b.joinRoom(room.room_id)
      expect(true).toBe(false) // should not reach
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    // Unban and verify Bob can rejoin (need re-invite for private room)
    await a.unban(room.room_id, b.userId)
    await a.invite(room.room_id, b.userId)
    await b.joinRoom(room.room_id)

    const members = await a.getMembers(room.room_id)
    const bobMember = members.chunk.find((e: any) => e.state_key === b.userId)
    expect(bobMember.content.membership).toBe('join')

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('cannot join private room without invite', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Private ${Date.now()}`, preset: 'private_chat' })

    try {
      await b.joinRoom(room.room_id)
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    await a.leaveRoom(room.room_id)
  })

  test('member count filter works', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Filter ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const members = await a.getMembers(room.room_id)
    const joinOnly = members.chunk.filter((e: any) => e.content.membership === 'join')
    expect(joinOnly.length).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
