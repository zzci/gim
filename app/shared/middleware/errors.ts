import type { Context } from 'hono'

export type MatrixErrorCode =
  | 'M_FORBIDDEN'
  | 'M_UNKNOWN_TOKEN'
  | 'M_MISSING_TOKEN'
  | 'M_BAD_JSON'
  | 'M_NOT_JSON'
  | 'M_NOT_FOUND'
  | 'M_LIMIT_EXCEEDED'
  | 'M_UNRECOGNIZED'
  | 'M_UNKNOWN'
  | 'M_UNAUTHORIZED'
  | 'M_USER_DEACTIVATED'
  | 'M_USER_IN_USE'
  | 'M_INVALID_USERNAME'
  | 'M_ROOM_IN_USE'
  | 'M_INVALID_ROOM_STATE'
  | 'M_EXCLUSIVE'
  | 'M_INVALID_PARAM'
  | 'M_MISSING_PARAM'
  | 'M_TOO_LARGE'
  | 'M_GUEST_ACCESS_FORBIDDEN'
  | 'M_RESOURCE_LIMIT_EXCEEDED'

const ERROR_STATUS: Partial<Record<MatrixErrorCode, number>> = {
  M_FORBIDDEN: 403,
  M_UNKNOWN_TOKEN: 401,
  M_MISSING_TOKEN: 401,
  M_UNAUTHORIZED: 401,
  M_NOT_FOUND: 404,
  M_LIMIT_EXCEEDED: 429,
  M_BAD_JSON: 400,
  M_NOT_JSON: 400,
  M_USER_IN_USE: 400,
  M_INVALID_USERNAME: 400,
  M_INVALID_PARAM: 400,
  M_MISSING_PARAM: 400,
  M_TOO_LARGE: 413,
  M_GUEST_ACCESS_FORBIDDEN: 403,
}

export function matrixError(c: Context, errcode: MatrixErrorCode, error: string, extra?: Record<string, unknown>) {
  const status = ERROR_STATUS[errcode] ?? 400
  return c.json({ errcode, error, ...extra }, status as any)
}

export function matrixNotFound(c: Context, error = 'Not found') {
  return matrixError(c, 'M_NOT_FOUND', error)
}

export function matrixForbidden(c: Context, error = 'Forbidden') {
  return matrixError(c, 'M_FORBIDDEN', error)
}

export function matrixUnknown(c: Context, error = 'Unknown error') {
  return matrixError(c, 'M_UNKNOWN', error)
}
