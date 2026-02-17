export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer '))
    return null
  return header.slice(7)
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
  return `{${entries.join(',')}}`
}

export function isCrossSigningResetVerified(
  authHeader: string | undefined,
  authUserId: string,
  authPayload: Record<string, unknown> | undefined,
): boolean {
  if (!authPayload || typeof authPayload !== 'object')
    return false

  const authType = typeof authPayload.type === 'string' ? authPayload.type : ''
  if (authType !== 'm.login.reauth')
    return false

  const bearer = extractBearerToken(authHeader)
  const sessionToken = typeof authPayload.session === 'string' ? authPayload.session : ''
  if (!bearer || !sessionToken || bearer !== sessionToken)
    return false

  const userId = typeof authPayload.user_id === 'string' ? authPayload.user_id : ''
  if (!userId || userId !== authUserId)
    return false

  return true
}
