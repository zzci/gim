/* eslint-disable */

import { createStorage } from 'unstorage'
import winston from 'winston'
import { sleep } from 'bun'

const isDebug  = process.env.NODE_ENV !== 'dev' ? false : true

declare global {
  var storage: ReturnType<typeof createStorage>
  var logger: winston.Logger
  var isDebug: boolean
  var sleep: typeof import('bun').sleep
}

// logger
const logger = winston.createLogger({
  level: isDebug ? 'debug' : 'info',
  transports: [new winston.transports.Console()],
  format: winston.format.cli(),
})

// storage
const storage = createStorage(/* opts */)

globalThis.storage = storage
globalThis.logger = logger
globalThis.isDebug = isDebug
globalThis.sleep = sleep
