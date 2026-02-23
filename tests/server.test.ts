import { describe, expect, test } from 'bun:test'
import { getAlice } from './helpers'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'

describe('Server Discovery', () => {
  test('GET /.well-known/matrix/client', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/matrix/client`)
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body['m.homeserver']).toBeDefined()
    expect(body['m.homeserver'].base_url).toBeTruthy()
  })

  test('GET /_matrix/client/versions', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/versions`)
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.versions).toBeDefined()
    expect(Array.isArray(body.versions)).toBe(true)
    expect(body.versions.length).toBeGreaterThan(0)
  })

  test('GET /_matrix/client/v3/capabilities', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/capabilities`)
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.capabilities).toBeDefined()
  })
})

describe('Auth', () => {
  test('GET /login returns supported flows', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/login`)
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.flows).toBeDefined()
    expect(Array.isArray(body.flows)).toBe(true)
  })

  test('whoami returns authenticated user', async () => {
    const a = await getAlice()
    const who = await a.whoami()
    expect(who.user_id).toBe(a.userId)
  })

  test('unauthenticated request returns 401', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/account/whoami`)
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.errcode).toBe('M_MISSING_TOKEN')
  })

  test('invalid token returns 401', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: 'Bearer invalid-token-12345' },
    })
    expect(res.status).toBe(401)
  })
})

describe('Typing', () => {
  test('set typing indicator', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Typing ${Date.now()}` })

    // Set typing
    await a.setTyping(room.room_id, a.userId, true, 5000)

    // Unset typing
    await a.setTyping(room.room_id, a.userId, false)

    await a.leaveRoom(room.room_id)
  })
})

describe('Read Receipts', () => {
  test('send receipt and read markers', async () => {
    const a = await getAlice()
    const room = await a.createRoom({ name: `Receipt ${Date.now()}` })

    const msg = await a.sendMessage(room.room_id, `receipt-${Date.now()}`, {
      msgtype: 'm.text',
      body: 'Receipt test',
    })

    // Send read receipt
    await a.sendReceipt(room.room_id, msg.event_id)

    // Set read marker
    await a.setReadMarker(room.room_id, msg.event_id, msg.event_id)

    // Verify via sync — receipts should appear in ephemeral
    const sync = await a.sync()
    const roomData = sync.rooms.join[room.room_id]
    expect(roomData).toBeDefined()

    const receiptEvent = roomData.ephemeral.events.find((e: any) => e.type === 'm.receipt')
    expect(receiptEvent).toBeDefined()

    await a.leaveRoom(room.room_id)
  })
})
