import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

describe('Admin', () => {
  test('GET /admin/api/stats returns counts', async () => {
    const a = await getAlice()
    const res = await a.adminStats()
    expect(res.users).toBeGreaterThanOrEqual(2)
    expect(res.rooms).toBeGreaterThanOrEqual(0)
    expect(typeof res.events).toBe('number')
    expect(typeof res.media).toBe('number')
  })

  test('GET /admin/api/users with search finds alice', async () => {
    const a = await getAlice()
    const res = await a.adminUsers({ search: 'alice' })
    expect(res.users.length).toBeGreaterThanOrEqual(1)
    const alice = res.users.find((u: any) => u.id.includes('alice'))
    expect(alice).toBeDefined()
  })

  test('GET /admin/api/users with limit/offset pagination', async () => {
    const a = await getAlice()
    const page1 = await a.adminUsers({ limit: 1, offset: 0 })
    expect(page1.users.length).toBe(1)
    expect(page1.total).toBeGreaterThanOrEqual(2)

    const page2 = await a.adminUsers({ limit: 1, offset: 1 })
    expect(page2.users.length).toBe(1)
    expect(page2.users[0].id).not.toBe(page1.users[0].id)
  })

  test('GET /admin/api/users/:userId returns user details', async () => {
    const a = await getAlice()
    const res = await a.adminUser(a.userId)
    expect(res.account).toBeDefined()
    expect(res.account.id).toBe(a.userId)
    expect(res.devices).toBeDefined()
    expect(Array.isArray(res.devices)).toBe(true)
    expect(res.rooms).toBeDefined()
    expect(Array.isArray(res.rooms)).toBe(true)
  })

  test('PUT /admin/api/users/:userId to grant and revoke admin', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Grant admin to bob
    const grant = await a.request('PUT', `/admin/api/users/${encodeURIComponent(b.userId)}`, { admin: true })
    expect(grant.admin).toBe(true)

    // Verify bob is admin
    const check = await a.adminUser(b.userId)
    expect(check.account.admin).toBe(true)

    // Revoke admin from bob
    const revoke = await a.request('PUT', `/admin/api/users/${encodeURIComponent(b.userId)}`, { admin: false })
    expect(revoke.admin).toBe(false)

    // Verify bob is no longer admin
    const check2 = await a.adminUser(b.userId)
    expect(check2.account.admin).toBe(false)
  })

  test('GET /admin/api/rooms returns room list', async () => {
    const a = await getAlice()

    // Create a room so we have at least one
    const room = await a.createRoom({ name: `Admin Room Test ${Date.now()}` })

    const res = await a.adminRooms()
    expect(res.rooms).toBeDefined()
    expect(Array.isArray(res.rooms)).toBe(true)
    expect(res.total).toBeGreaterThanOrEqual(1)

    await a.leaveRoom(room.room_id)
  })

  test('GET /admin/api/rooms/:roomId returns room with members', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ name: `Admin Room Detail ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    const res = await a.request('GET', `/admin/api/rooms/${encodeURIComponent(room.room_id)}`)
    expect(res.room).toBeDefined()
    expect(res.room.id).toBe(room.room_id)
    expect(res.members).toBeDefined()
    expect(res.members.length).toBe(2)

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('GET /admin/api/media returns media list', async () => {
    const a = await getAlice()
    const res = await a.request('GET', '/admin/api/media')
    expect(res.media).toBeDefined()
    expect(Array.isArray(res.media)).toBe(true)
    expect(typeof res.total).toBe('number')
  })

  test('GET /admin/api/tokens returns token list', async () => {
    const a = await getAlice()
    const res = await a.adminTokens()
    expect(res.oauth_tokens || res.user_tokens).toBeDefined()
  })

  test('GET /admin/api/audit-log returns entries', async () => {
    const a = await getAlice()
    const res = await a.request('GET', '/admin/api/audit-log')
    expect(res.entries).toBeDefined()
    expect(Array.isArray(res.entries)).toBe(true)
    expect(typeof res.total).toBe('number')
  })
})

describe('Admin - non-admin access denied', () => {
  test('bob gets 403 on stats', async () => {
    const b = await getBob()
    try {
      await b.adminStats()
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }
  })

  test('bob gets 403 on users', async () => {
    const b = await getBob()
    try {
      await b.adminUsers()
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }
  })

  test('bob gets 403 on rooms', async () => {
    const b = await getBob()
    try {
      await b.adminRooms()
      expect(true).toBe(false)
    }
    catch (err: any) {
      expect(err.status).toBe(403)
    }
  })
})
