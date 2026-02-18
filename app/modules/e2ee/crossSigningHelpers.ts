export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer '))
    return null
  return header.slice(7)
}

export type CrossSigningDbType = 'master' | 'self_signing' | 'user_signing'

export const CROSS_SIGNING_ACCOUNT_DATA_TYPE: Record<CrossSigningDbType, string> = {
  master: 'm.cross_signing.master',
  self_signing: 'm.cross_signing.self_signing',
  user_signing: 'm.cross_signing.user_signing',
}

export const CROSS_SIGNING_ACCOUNT_DATA_TYPES = Object.values(CROSS_SIGNING_ACCOUNT_DATA_TYPE)

export function accountDataTypeToCrossSigningType(type: string): CrossSigningDbType | null {
  if (type === CROSS_SIGNING_ACCOUNT_DATA_TYPE.master)
    return 'master'
  if (type === CROSS_SIGNING_ACCOUNT_DATA_TYPE.self_signing)
    return 'self_signing'
  if (type === CROSS_SIGNING_ACCOUNT_DATA_TYPE.user_signing)
    return 'user_signing'
  return null
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
