import { describe, expect, test } from 'bun:test'
import { resolveUpstreamLocalpart } from '@/oauth/provider'

describe('oauth upstream localpart resolution', () => {
  test('uses preferred_username when present', () => {
    const result = resolveUpstreamLocalpart({
      preferred_username: 'alice',
      username: 'bob',
    })
    expect(result).toEqual({ localpart: 'alice', source: 'preferred_username' })
  })

  test('supports misspelled preffered_username key for compatibility', () => {
    const result = resolveUpstreamLocalpart({
      preffered_username: 'charlie',
    })
    expect(result).toEqual({ localpart: 'charlie', source: 'preffered_username' })
  })

  test('returns missing when upstream has no username claims', () => {
    const result = resolveUpstreamLocalpart({})
    expect(result).toEqual({ localpart: '', source: 'missing' })
  })
})
