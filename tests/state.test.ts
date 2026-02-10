import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

const SERVER_NAME = process.env.IM_SERVER_NAME || 'localhost'

describe('State Events', () => {
  test('set and get room name', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `State Name ${Date.now()}` })

    await a.sendStateEvent(room.room_id, 'm.room.name', '', { name: 'Updated Name' })
    const state = await a.getStateEvent(room.room_id, 'm.room.name')
    expect(state.name).toBe('Updated Name')

    await a.leaveRoom(room.room_id)
  })

  test('set and get room topic', async () => {
    const a = await getAlice()
    const room = await a.createRoom({})

    await a.sendStateEvent(room.room_id, 'm.room.topic', '', { topic: 'Test Topic' })
    const state = await a.getStateEvent(room.room_id, 'm.room.topic')
    expect(state.topic).toBe('Test Topic')

    await a.leaveRoom(room.room_id)
  })

  test('get all state events for a room', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `All State ${Date.now()}`, topic: 'Topic' })

    // GET /rooms/:roomId/state returns all current state
    const res = await a.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/state`)
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBeGreaterThan(0)

    // Should include m.room.create and m.room.name at minimum
    const types = res.map((e: any) => e.type)
    expect(types).toContain('m.room.create')
    expect(types).toContain('m.room.name')

    await a.leaveRoom(room.room_id)
  })

  test('non-member cannot set state', async () => {
    const a = await getAlice()
    const b = await getBob()
    const room = await a.createRoom({ name: `No State ${Date.now()}` })

    try {
      await b.sendStateEvent(room.room_id, 'm.room.topic', '', { topic: 'Hacked' })
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }

    await a.leaveRoom(room.room_id)
  })

  test('custom state event with state_key', async () => {
    const a = await getAlice()
    const room = await a.createRoom({})

    await a.sendStateEvent(room.room_id, 'com.test.custom', 'my_key', { data: 42 })
    const state = await a.getStateEvent(room.room_id, 'com.test.custom', 'my_key')
    expect(state.data).toBe(42)

    await a.leaveRoom(room.room_id)
  })
})

describe('Room Aliases', () => {
  test('create, resolve, and delete alias', async () => {
    const a = await getAlice()
    const room = await a.createRoom({})
    const alias = `#alias-test-${Date.now()}:${SERVER_NAME}`

    // Create
    await a.createAlias(alias, room.room_id)

    // Resolve
    const resolved = await a.resolveAlias(alias)
    expect(resolved.room_id).toBe(room.room_id)
    expect(resolved.servers).toContain(SERVER_NAME)

    // Delete
    await a.deleteAlias(alias)

    // Resolve should fail
    try {
      await a.resolveAlias(alias)
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(404)
    }

    await a.leaveRoom(room.room_id)
  })

  test('join room by alias', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ preset: 'public_chat' })
    const alias = `#join-alias-${Date.now()}:${SERVER_NAME}`
    await a.createAlias(alias, room.room_id)

    await b.joinRoom(alias)
    const joined = await b.joinedRooms()
    expect(joined.joined_rooms).toContain(room.room_id)

    await a.deleteAlias(alias)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})

describe('User Profile', () => {
  test('set and get display name', async () => {
    const a = await getAlice()
    const name = `Alice Test ${Date.now()}`

    await a.setDisplayName(a.userId, name)
    const profile = await a.getProfile(a.userId)
    expect(profile.displayname).toBe(name)

    // Restore
    await a.setDisplayName(a.userId, 'Alice')
  })

  test('set and get avatar URL', async () => {
    const a = await getAlice()
    const url = `mxc://${SERVER_NAME}/test-avatar-${Date.now()}`

    await a.setAvatarUrl(a.userId, url)
    const profile = await a.getProfile(a.userId)
    expect(profile.avatar_url).toBe(url)
  })
})

describe('Account Data', () => {
  test('set and get global account data', async () => {
    const a = await getAlice()
    const type = `com.test.data.${Date.now()}`

    await a.setAccountData(a.userId, type, { key: 'value' })
    const data = await a.getAccountData(a.userId, type)
    expect(data.key).toBe('value')
  })

  test('set and get room account data', async () => {
    const a = await getAlice()
    const room = await a.createRoom({})
    const type = `com.test.room.${Date.now()}`

    await a.setRoomAccountData(room.room_id, type, { room_key: 123 })
    const data = await a.getRoomAccountData(room.room_id, type)
    expect(data.room_key).toBe(123)

    await a.leaveRoom(room.room_id)
  })

  test('get nonexistent account data returns 404', async () => {
    const a = await getAlice()
    try {
      await a.getAccountData(a.userId, 'com.nonexistent.type')
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(404)
    }
  })
})
