/* eslint-disable */

import winston from 'winston'
import { sleep } from 'bun'
import { logFormat } from '@/config'

const isDebug  = process.env.NODE_ENV !== 'dev' ? false : true

declare global {
  var logger: winston.Logger
  var isDebug: boolean
  var sleep: typeof import('bun').sleep
}

const jsonTransport = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
)

const cliTransport = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const requestId = meta.requestId ? ` [${String(meta.requestId).slice(0, 8)}]` : ''
    const userId = meta.userId ? ` ${String(meta.userId)}` : ''
    const rest = Object.keys(meta).filter(k => !['requestId', 'userId', 'timestamp', 'service'].includes(k))
    const extra = rest.length > 0 ? ` ${JSON.stringify(Object.fromEntries(rest.map(k => [k, meta[k]])))}` : ''
    return `${timestamp} ${level}${requestId}${userId}: ${message}${extra}`
  }),
)

const logger = winston.createLogger({
  level: isDebug ? 'debug' : 'info',
  defaultMeta: { service: 'gim' },
  transports: [
    new winston.transports.Console({
      format: logFormat === 'json' ? jsonTransport : cliTransport,
    }),
  ],
})

globalThis.logger = logger
globalThis.isDebug = isDebug
globalThis.sleep = sleep
