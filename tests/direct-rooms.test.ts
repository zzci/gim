import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

describe('Direct Rooms', () => {
  test('createRoom with is_direct includes is_direct in invite event content', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({
      is_direct: true,
      invite: [b.userId],
    })
    expect(room.room_id).toMatch(/^!/)

    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('createRoom without is_direct does NOT include is_direct in invite', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({
      invite: [b.userId],
    })

    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBeUndefined()

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('standalone invite endpoint passes is_direct to event content', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ is_direct: true })

    await a.request(
      'POST',
      `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/invite`,
      { user_id: b.userId, is_direct: true },
    )

    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('Bob sees is_direct in invite via sync', async () => {
    const a = await getAlice()
    const b = await getBob()

    const initialSync = await b.sync({ timeout: 0 })
    const since = initialSync.next_batch

    const room = await a.createRoom({
      is_direct: true,
      invite: [b.userId],
    })

    const sync = await b.sync({ since, timeout: 1000 })
    const inviteRooms = sync.rooms?.invite || {}
    const inviteRoom = inviteRooms[room.room_id]
    expect(inviteRoom).toBeTruthy()

    const memberEvent = inviteRoom.invite_state.events.find(
      (e: any) => e.type === 'm.room.member' && e.state_key === b.userId,
    )
    expect(memberEvent).toBeTruthy()
    expect(memberEvent.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
