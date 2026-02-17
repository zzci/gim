import { Hono } from 'hono'
import { registerAdminAuditLogRoute } from './auditLogRoute'
import { registerAdminAuthRoutes } from './authRoutes'
import { registerAdminDevicesRoutes } from './devicesRoutes'
import { registerAdminMediaRoutes } from './mediaRoutes'
import { adminMiddleware } from './middleware'
import { registerAdminRoomsRoutes } from './roomsRoutes'
import { registerAdminStatsRoutes } from './statsRoutes'
import { registerAdminTokensRoutes } from './tokensRoutes'
import { registerAdminUsersRoutes } from './usersRoutes'

export const adminRoute = new Hono()

registerAdminAuthRoutes(adminRoute)

adminRoute.use('/api/*', adminMiddleware)

registerAdminStatsRoutes(adminRoute)
registerAdminUsersRoutes(adminRoute)
registerAdminRoomsRoutes(adminRoute)
registerAdminDevicesRoutes(adminRoute)
registerAdminMediaRoutes(adminRoute)
registerAdminTokensRoutes(adminRoute)
registerAdminAuditLogRoute(adminRoute)
