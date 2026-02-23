import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { authMiddleware } from '@/shared/middleware/auth'
import { registerAccountDataRoutes } from './accountDataRoutes'
import { registerContextRoute } from './contextRoute'
import { registerEventByIdRoute } from './eventByIdRoute'
import { registerMessagesRoute } from './messagesRoute'
import { registerReceiptRoutes } from './receiptRoutes'
import { registerRedactRoute } from './redactRoute'
import { registerSendEventRoute } from './sendEventRoute'
import { registerStateRoutes } from './stateRoutes'
import { registerTypingRoute } from './typingRoute'

export const messageRouter = new Hono<AuthEnv>()

messageRouter.use('/*', authMiddleware)

registerSendEventRoute(messageRouter)
registerMessagesRoute(messageRouter)
registerEventByIdRoute(messageRouter)
registerRedactRoute(messageRouter)
registerStateRoutes(messageRouter)
registerTypingRoute(messageRouter)
registerReceiptRoutes(messageRouter)
registerContextRoute(messageRouter)
registerAccountDataRoutes(messageRouter)
