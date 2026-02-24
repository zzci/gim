import { describe, expect, test } from 'bun:test'
import { generateFallbackLocalpart, resolveUpstreamLocalpart } from '@/oauth/provider'

describe('oauth upstream localpart resolution', () => {
  test('generates gid- plus 10 lowercase alphanumeric chars', () => {
    const localpart = generateFallbackLocalpart()
    expect(localpart).toMatch(/^gid-[a-z0-9]{10}$/)
  })

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

  test('falls back to generated gid id when upstream has no username claims', () => {
    const result = resolveUpstreamLocalpart({})
    expect(result.source).toBe('generated')
    expect(result.localpart).toMatch(/^gid-[a-z0-9]{10}$/)
  })
})
