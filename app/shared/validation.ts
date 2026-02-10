import type { Context } from 'hono'
import { z } from 'zod/v4'
import { matrixError } from '@/shared/middleware/errors'

export const matrixUserId = z.string().regex(
  /^@[a-z0-9._=/+-]+:[a-zA-Z0-9.-]+$/,
  'Invalid Matrix user ID format',
)

export const eventContent = z.record(z.string(), z.unknown()).refine(
  v => JSON.stringify(v).length <= 65535,
  'Event content exceeds 64KB limit',
)

export const displayName = z.string().max(256, 'Display name must be 256 characters or fewer')

export const avatarUrl = z.string().max(1024, 'Avatar URL must be 1024 characters or fewer').startsWith('mxc://', 'Avatar URL must start with mxc://')

export const createRoomBody = z.object({
  name: z.string().max(255).optional(),
  topic: z.string().max(1024).optional(),
  invite: z.array(matrixUserId).optional(),
  room_alias_name: z.string().max(255).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  preset: z.enum(['private_chat', 'public_chat', 'trusted_private_chat']).optional(),
  is_direct: z.boolean().optional(),
  initial_state: z.array(z.record(z.string(), z.unknown())).optional(),
  power_level_content_override: z.record(z.string(), z.unknown()).optional(),
})

export const membershipBody = z.object({
  user_id: matrixUserId,
  reason: z.string().max(1024).optional(),
}).passthrough()

export const loginBody = z.object({
  type: z.string(),
  token: z.string().optional(),
  device_id: z.string().optional(),
  initial_device_display_name: z.string().max(256).optional(),
}).passthrough()

export const deviceUpdateBody = z.object({
  display_name: displayName.optional(),
}).passthrough()

export function validate<T>(c: Context, schema: z.ZodType<T>, data: unknown): { success: true, data: T } | { success: false, response: Response } {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = result.error.issues[0]?.message || 'Invalid request body'
    return { success: false, response: matrixError(c, 'M_BAD_JSON', message) as unknown as Response }
  }
  return { success: true, data: result.data }
}
