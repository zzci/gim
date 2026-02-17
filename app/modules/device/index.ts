import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { deviceDeleteRoute } from './deleteDeviceRoute'
import { deviceGetRoute } from './getDeviceRoute'
import { deviceListRoute } from './listDevicesRoute'
import { devicePutRoute } from './putDeviceRoute'

export const deviceRoute = new Hono<AuthEnv>()

deviceRoute.route('/', deviceListRoute)
deviceRoute.route('/', deviceGetRoute)
deviceRoute.route('/', devicePutRoute)
deviceRoute.route('/', deviceDeleteRoute)
