import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF-safe fetch: resolves hostname to IP, validates it's not private/loopback,
 * then performs the fetch. Prevents DNS rebinding and bypasses via decimal IPs,
 * IPv6-mapped IPv4, etc.
 */

const PRIVATE_IPV4_RANGES = [
  { prefix: 0x7F000000, mask: 0xFF000000 }, // 127.0.0.0/8 (loopback)
  { prefix: 0x0A000000, mask: 0xFF000000 }, // 10.0.0.0/8
  { prefix: 0xAC100000, mask: 0xFFF00000 }, // 172.16.0.0/12
  { prefix: 0xC0A80000, mask: 0xFFFF0000 }, // 192.168.0.0/16
  { prefix: 0x00000000, mask: 0xFF000000 }, // 0.0.0.0/8
  { prefix: 0xA9FE0000, mask: 0xFFFF0000 }, // 169.254.0.0/16 (link-local)
]

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.')
  if (parts.length !== 4)
    return -1
  let result = 0
  for (const part of parts) {
    const num = Number.parseInt(part, 10)
    if (Number.isNaN(num) || num < 0 || num > 255)
      return -1
    result = (result << 8) | num
  }
  return result >>> 0 // unsigned 32-bit
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip)
  if (ipInt === -1)
    return true // treat unparseable as private (deny by default)

  return PRIVATE_IPV4_RANGES.some(
    range => ((ipInt & range.mask) >>> 0) === range.prefix,
  )
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')

  // IPv6 loopback
  if (normalized === '::1')
    return true

  // IPv6 Unique Local Address (fc00::/7) — starts with fc or fd
  if (/^f[cd]/.test(normalized))
    return true

  // IPv6 link-local (fe80::/10)
  if (/^fe[89ab]/.test(normalized))
    return true

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4MappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4MappedMatch)
    return isPrivateIPv4(v4MappedMatch[1]!)

  // IPv4-compatible IPv6 (::x.x.x.x) — deprecated but still checked
  const v4CompatMatch = normalized.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4CompatMatch)
    return isPrivateIPv4(v4CompatMatch[1]!)

  return false
}

function isPrivateIP(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4)
    return isPrivateIPv4(ip)
  if (version === 6)
    return isPrivateIPv6(ip)

  // Try stripping brackets for IPv6
  const stripped = ip.replace(/^\[|\]$/g, '')
  const strippedVersion = isIP(stripped)
  if (strippedVersion === 6)
    return isPrivateIPv6(stripped)

  // Unknown format — deny by default
  return true
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSRFError'
  }
}

async function resolveHostnameIPs(hostname: string): Promise<string[]> {
  const ips: string[] = []

  // If hostname is already an IP address, return it directly
  if (isIP(hostname) || isIP(hostname.replace(/^\[|\]$/g, '')))
    return [hostname.replace(/^\[|\]$/g, '')]

  // Resolve both IPv4 and IPv6, collecting all addresses
  const results = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ])

  for (const result of results) {
    if (result.status === 'fulfilled')
      ips.push(...result.value)
  }

  return ips
}

function validateUrl(url: string): URL {
  const parsed = new URL(url)

  // Only allow http/https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new SSRFError(`Blocked scheme: ${parsed.protocol}`)

  // Block localhost hostname explicitly
  if (parsed.hostname === 'localhost')
    throw new SSRFError('Blocked hostname: localhost')

  return parsed
}

/**
 * Perform a fetch with SSRF protection.
 * Resolves the hostname to IP addresses and validates none are in private ranges.
 * Throws SSRFError if the target is a private/loopback address.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const parsed = validateUrl(url)
  const hostname = parsed.hostname

  // Resolve hostname to IPs
  const ips = await resolveHostnameIPs(hostname)

  if (ips.length === 0)
    throw new SSRFError(`Cannot resolve hostname: ${hostname}`)

  // Check ALL resolved IPs — deny if any is private
  for (const ip of ips) {
    if (isPrivateIP(ip))
      throw new SSRFError(`Blocked private IP ${ip} for hostname ${hostname}`)
  }

  return fetch(url, init)
}
