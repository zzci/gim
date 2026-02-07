import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'

export const apiRoute = new Hono()

apiRoute.get('/', swaggerUI({ url: 'https://spec.matrix.org/v1.14/client-server-api/api.json' }))
