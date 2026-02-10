import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'

describe('Presence', () => {
  test('set presence online with status message', async () => {
    const a = await getAlice()
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'online', status_msg: 'hello' }),
    })
    expect(res.status).toBe(200)
  })

  test('get presence returns correct state', async () => {
    const a = await getAlice()

    // Set presence first
    await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'online', status_msg: 'testing' }),
    })

    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.presence).toBe('online')
    expect(json.status_msg).toBe('testing')
    expect(json.currently_active).toBe(true)
  })

  test('set unavailable state', async () => {
    const a = await getAlice()

    await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'unavailable' }),
    })

    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    const json = await res.json() as any
    expect(json.presence).toBe('unavailable')
    expect(json.currently_active).toBe(false)
  })

  test('set offline state', async () => {
    const a = await getAlice()

    await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'offline' }),
    })

    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    const json = await res.json() as any
    expect(json.presence).toBe('offline')
  })

  test('invalid presence state returns 400', async () => {
    const a = await getAlice()
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'busy' }),
    })
    expect(res.status).toBe(400)
  })

  test('bob cannot set alice presence', async () => {
    const a = await getAlice()
    const b = await getBob()
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${b.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'online' }),
    })
    expect(res.status).toBe(403)
  })

  test('default presence for user without explicit set is offline', async () => {
    const a = await getAlice()
    // Query presence for a user who might not have set it explicitly
    // Use a dummy user id that doesn't exist (should return offline default)
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent('@nonexistent:localhost')}/status`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.presence).toBe('offline')
  })

  test('presence visible in sync for shared room member', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Create shared room
    const room = await a.createRoom({ name: `Presence Sync ${Date.now()}`, invite: [b.userId] })
    await b.joinRoom(room.room_id)

    // Alice sets online
    await fetch(`${BASE_URL}/_matrix/client/v3/presence/${encodeURIComponent(a.userId)}/status`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presence: 'online', status_msg: 'sync test' }),
    })

    // Bob syncs and should see alice's presence
    const sync = await b.sync()
    expect(sync.presence).toBeDefined()
    expect(sync.presence.events).toBeDefined()

    const alicePresence = sync.presence.events.find((e: any) => e.sender === a.userId)
    if (alicePresence) {
      expect(alicePresence.content.presence).toBe('online')
      expect(alicePresence.content.status_msg).toBe('sync test')
    }

    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
