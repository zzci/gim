import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'

const dbPath = process.env.DB_PATH || 'data/gim.db'

mkdirSync(dirname(dbPath), { recursive: true })

const db = new Database(dbPath, { create: true })

try {
  db.exec('PRAGMA foreign_keys = OFF;')

  const rows = db.query('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\'').all() as Array<{ name: string }>
  for (const { name } of rows) {
    const safe = name.replace(/"/g, '""')
    db.exec(`DROP TABLE IF EXISTS "${safe}";`)
  }

  db.exec('PRAGMA foreign_keys = ON;')
  // eslint-disable-next-line no-console
  console.log(`Database reset completed: ${dbPath} (dropped ${rows.length} tables)`)
}
finally {
  db.close()
}
