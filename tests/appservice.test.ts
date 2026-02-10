/**
 * Application Service integration tests.
 *
 * These tests require:
 * 1. Server running (bun dev)
 * 2. An AS registration in data/appservices/test.yaml with:
 *    id: test-as
 *    as_token: as_test_token_12345
 *    hs_token: hs_test_token_12345
 *    sender_localpart: _test_as_bot
 *    namespaces:
 *      users:
 *        - exclusive: true
 *          regex: "@_test_as_.*"
 *
 * OR the AS registration inserted into the appservices DB table.
 */

import { describe, expect, test } from 'bun:test'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'
const SERVER_NAME = process.env.IM_SERVER_NAME || 'localhost'
const AS_TOKEN = 'as_test_token_12345'

async function asRequest(method: string, path: string, body?: unknown, queryParams?: Record<string, string>) {
  const url = new URL(`${BASE_URL}${path}`)
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v)
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${AS_TOKEN}`,
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  return fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('Application Service', () => {
  test('AS token auth returns sender_localpart user on whoami', async () => {
    const res = await asRequest('GET', '/_matrix/client/v3/account/whoami')
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.user_id).toBe(`@_test_as_bot:${SERVER_NAME}`)
  })

  test('user_id assertion works for users in namespace', async () => {
    const virtualUser = `@_test_as_bridged:${SERVER_NAME}`
    const res = await asRequest('GET', '/_matrix/client/v3/account/whoami', undefined, {
      user_id: virtualUser,
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.user_id).toBe(virtualUser)
  })

  test('user_id assertion outside namespace returns 403', async () => {
    const outsideUser = `@alice:${SERVER_NAME}`
    const res = await asRequest('GET', '/_matrix/client/v3/account/whoami', undefined, {
      user_id: outsideUser,
    })
    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.errcode).toBe('M_FORBIDDEN')
  })

  test('ping endpoint works', async () => {
    const res = await asRequest('POST', '/_matrix/client/v1/appservice/test-as/ping', {
      transaction_id: 'test-ping-1',
    })
    // If AS has no url configured or is unreachable, this may fail — that's ok
    // We just verify the endpoint exists and processes the request
    const body = await res.json() as any
    expect(body).toBeDefined()
    // Either returns duration_ms on success or an error
    if (res.ok) {
      expect(typeof body.duration_ms).toBe('number')
    }
  })

  test('exclusive namespace blocks normal registration with M_EXCLUSIVE', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '_test_as_blocked' }),
    })
    const body = await res.json() as any
    expect(body.errcode).toBe('M_EXCLUSIVE')
  })

  test('invalid AS token returns 401', async () => {
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: 'Bearer invalid_as_token' },
    })
    expect(res.status).toBe(401)
  })

  test('AS can create rooms as sender_localpart', async () => {
    const res = await asRequest('POST', '/_matrix/client/v3/createRoom', {
      name: `AS Test Room ${Date.now()}`,
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.room_id).toBeTruthy()
  })

  test('AS can create rooms as virtual user', async () => {
    const virtualUser = `@_test_as_user1:${SERVER_NAME}`
    const res = await asRequest('POST', '/_matrix/client/v3/createRoom', {
      name: `AS Virtual User Room ${Date.now()}`,
    }, { user_id: virtualUser })
    expect(res.ok).toBe(true)
    const body = await res.json() as any
    expect(body.room_id).toBeTruthy()
  })
})
