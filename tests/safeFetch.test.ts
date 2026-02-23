import { describe, expect, it } from 'bun:test'
import { safeFetch, SSRFError } from '@/utils/safeFetch'

describe('safeFetch SSRF protection', () => {
  describe('blocks private/loopback addresses', () => {
    const blockedUrls = [
      // Standard private IPs
      'http://127.0.0.1/test',
      'http://10.0.0.1/test',
      'http://172.16.0.1/test',
      'http://172.31.255.255/test',
      'http://192.168.1.1/test',
      'http://0.0.0.0/test',
      'http://169.254.169.254/test', // AWS metadata

      // Localhost hostname
      'http://localhost/test',
      'https://localhost:8080/test',

      // IPv6 loopback
      'http://[::1]/test',

      // IPv6 private
      'http://[fc00::1]/test',
      'http://[fd12:3456::1]/test',

      // IPv6 link-local
      'http://[fe80::1]/test',
    ]

    for (const url of blockedUrls) {
      it(`blocks ${url}`, async () => {
        await expect(safeFetch(url)).rejects.toThrow(SSRFError)
      })
    }
  })

  describe('blocks non-http schemes', () => {
    const blockedSchemes = [
      'ftp://example.com/test',
      'file:///etc/passwd',
      'gopher://example.com/test',
    ]

    for (const url of blockedSchemes) {
      it(`blocks ${url}`, async () => {
        await expect(safeFetch(url)).rejects.toThrow(SSRFError)
      })
    }
  })

  describe('blocks decimal IP bypass (2130706433 = 127.0.0.1)', () => {
    // When a decimal IP is used as hostname, URL parsing treats it as a hostname string.
    // DNS resolution will fail for it (it's not a real hostname), so safeFetch blocks it.
    it('blocks http://2130706433/ via DNS resolution failure', async () => {
      await expect(safeFetch('http://2130706433/')).rejects.toThrow(SSRFError)
    })
  })

  describe('validates URL parsing', () => {
    it('throws on invalid URL', async () => {
      await expect(safeFetch('not-a-url')).rejects.toThrow()
    })
  })

  describe('allows public URLs (would need real DNS)', () => {
    // This test verifies safeFetch allows known-public hosts through
    // It requires network access, so it's a real integration test
    it('allows https://example.com', async () => {
      const response = await safeFetch('https://example.com')
      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(500)
    })
  })
})
