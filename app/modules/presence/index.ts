import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { presenceGetStatusRoute } from './getStatusRoute'
import { presencePutStatusRoute } from './putStatusRoute'

export const presenceRoute = new Hono<AuthEnv>()

presenceRoute.route('/', presenceGetStatusRoute)
presenceRoute.route('/', presencePutStatusRoute)
