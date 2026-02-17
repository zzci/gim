import { Hono } from 'hono'
import { discoveryDocument } from '@/oauth/provider'

export const metadataRoute = new Hono()

metadataRoute.get('/', c => c.json(discoveryDocument()))
