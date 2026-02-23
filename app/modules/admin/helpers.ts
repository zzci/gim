import { db } from '@/db'
import { adminAuditLog } from '@/db/schema'

export function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> | null,
  ipAddress: string | null,
) {
  db.insert(adminAuditLog).values({
    adminUserId,
    action,
    targetType,
    targetId,
    details,
    ipAddress,
  }).run()
}

export function getAdminContext(c: { get: (key: string) => unknown, req: { header: (name: string) => string | undefined } }) {
  const auth = c.get('auth') as { userId: string }
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null
  return { adminUserId: auth.userId, ip }
}
