import type { Config } from 'drizzle-kit'

export default {
  schema: './app/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || 'data/gim.db',
  },
} satisfies Config
