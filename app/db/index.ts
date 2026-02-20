import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './schema'

const dbPath = process.env.DB_PATH || 'data/gim.db'

// Ensure the data directory exists
const dir = dirname(dbPath)
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

const sqlite = new Database(dbPath)

// Enable WAL mode for better concurrent read performance
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')
sqlite.exec('PRAGMA busy_timeout = 15000')
sqlite.exec('PRAGMA synchronous = NORMAL')
sqlite.exec('PRAGMA cache_size = -64000')
sqlite.exec('PRAGMA mmap_size = 268435456')

export const db = drizzle({ client: sqlite, schema })
export { sqlite }

// Auto-migrate on startup (guarded for concurrent process / test worker startup)
try {
  migrate(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') })
}
catch (err: any) {
  // Ignore "already exists" errors from parallel startup; rethrow everything else
  const msg = String(err?.message) + String(err?.cause?.message ?? '')
  if (!msg.includes('already exists')) {
    throw err
  }
}
