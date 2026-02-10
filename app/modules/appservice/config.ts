import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { asRegistrationDir, serverName } from '@/config'
import { db } from '@/db'
import { accounts, appservices, eventsState, eventsTimeline } from '@/db/schema'

// --- Zod schema for AS registration YAML ---

const namespaceEntrySchema = z.object({
  exclusive: z.boolean().optional().default(false),
  regex: z.string(),
})

const namespacesSchema = z.object({
  users: z.array(namespaceEntrySchema).optional().default([]),
  aliases: z.array(namespaceEntrySchema).optional().default([]),
  rooms: z.array(namespaceEntrySchema).optional().default([]),
})

const registrationSchema = z.object({
  id: z.string(),
  url: z.string().optional(),
  as_token: z.string(),
  hs_token: z.string(),
  sender_localpart: z.string(),
  namespaces: namespacesSchema.optional().default({}),
  rate_limited: z.boolean().optional(),
  protocols: z.array(z.string()).optional(),
})

// --- Compiled registration types ---

interface CompiledNamespaceEntry {
  exclusive: boolean
  regex: RegExp
}

export interface CompiledRegistration {
  id: string // DB primary key
  asId: string // AS-declared identifier
  url?: string | null
  asToken: string
  hsToken: string
  senderLocalpart: string
  namespaces: {
    users: CompiledNamespaceEntry[]
    aliases: CompiledNamespaceEntry[]
    rooms: CompiledNamespaceEntry[]
  }
  rateLimited?: boolean | null
  protocols?: string[] | null
}

// --- In-memory caches (rebuilt from DB) ---

const registrationsById = new Map<string, CompiledRegistration>()
const registrationsByAsId = new Map<string, CompiledRegistration>()
const registrationsByAsToken = new Map<string, CompiledRegistration>()

function compileNamespaceEntries(entries?: { exclusive?: boolean, regex: string }[]): CompiledNamespaceEntry[] {
  if (!entries)
    return []
  return entries.map(e => ({
    exclusive: e.exclusive ?? false,
    regex: new RegExp(e.regex),
  }))
}

function compileRow(row: typeof appservices.$inferSelect): CompiledRegistration {
  const ns = row.namespaces as {
    users?: { exclusive?: boolean, regex: string }[]
    aliases?: { exclusive?: boolean, regex: string }[]
    rooms?: { exclusive?: boolean, regex: string }[]
  }

  return {
    id: row.id,
    asId: row.asId,
    url: row.url,
    asToken: row.asToken,
    hsToken: row.hsToken,
    senderLocalpart: row.senderLocalpart,
    namespaces: {
      users: compileNamespaceEntries(ns.users),
      aliases: compileNamespaceEntries(ns.aliases),
      rooms: compileNamespaceEntries(ns.rooms),
    },
    rateLimited: row.rateLimited,
    protocols: row.protocols,
  }
}

function rebuildCache(): void {
  registrationsById.clear()
  registrationsByAsId.clear()
  registrationsByAsToken.clear()

  const rows = db.select().from(appservices).all()
  for (const row of rows) {
    try {
      const compiled = compileRow(row)
      registrationsById.set(compiled.id, compiled)
      registrationsByAsId.set(compiled.asId, compiled)
      registrationsByAsToken.set(compiled.asToken, compiled)
    }
    catch (err) {
      logger.error('appservice_compile_failed', { id: row.id, asId: row.asId, error: String(err) })
    }
  }
}

// --- Import YAML registrations into DB ---

function importYamlRegistrations(): void {
  if (!existsSync(asRegistrationDir)) {
    mkdirSync(asRegistrationDir, { recursive: true })
    return
  }

  const files = readdirSync(asRegistrationDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))

  // Get current max stream position for new registrations
  const stateMax = db.select({ id: eventsState.id }).from(eventsState).orderBy(sql`id DESC`).limit(1).get()
  const timelineMax = db.select({ id: eventsTimeline.id }).from(eventsTimeline).orderBy(sql`id DESC`).limit(1).get()
  const ids = [stateMax?.id, timelineMax?.id].filter(Boolean) as string[]
  const maxPos = ids.length > 0 ? ids.sort().pop()! : ''

  for (const file of files) {
    const filePath = join(asRegistrationDir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = parseYaml(raw)
      const validated = registrationSchema.parse(parsed)

      // Check if this AS is already in DB by asId
      const existing = db.select({ id: appservices.id })
        .from(appservices)
        .where(eq(appservices.asId, validated.id))
        .get()

      if (existing) {
        // Update existing registration
        db.update(appservices).set({
          url: validated.url ?? null,
          asToken: validated.as_token,
          hsToken: validated.hs_token,
          senderLocalpart: validated.sender_localpart,
          namespaces: {
            users: validated.namespaces.users,
            aliases: validated.namespaces.aliases,
            rooms: validated.namespaces.rooms,
          },
          rateLimited: validated.rate_limited ?? false,
          protocols: validated.protocols ?? null,
        }).where(eq(appservices.id, existing.id)).run()
        logger.info('appservice_yaml_updated', { asId: validated.id, file })
      }
      else {
        // Insert new registration
        db.insert(appservices).values({
          asId: validated.id,
          url: validated.url ?? null,
          asToken: validated.as_token,
          hsToken: validated.hs_token,
          senderLocalpart: validated.sender_localpart,
          namespaces: {
            users: validated.namespaces.users,
            aliases: validated.namespaces.aliases,
            rooms: validated.namespaces.rooms,
          },
          rateLimited: validated.rate_limited ?? false,
          protocols: validated.protocols ?? null,
          lastStreamPosition: maxPos,
        }).run()
        logger.info('appservice_yaml_imported', { asId: validated.id, file })
      }

      // Auto-create sender_localpart user if missing
      ensureAppServiceUser(`@${validated.sender_localpart}:${serverName}`)
    }
    catch (err) {
      logger.error('appservice_yaml_load_failed', { file, error: String(err) })
    }
  }
}

// --- Startup ---

export function loadAppServiceRegistrations(): void {
  importYamlRegistrations()
  rebuildCache()
  logger.info('appservice_registrations_loaded', { count: registrationsById.size })
}

export function reloadRegistrations(): void {
  rebuildCache()
}

// --- Lookups ---

export function getRegistrationByAsToken(token: string): CompiledRegistration | undefined {
  return registrationsByAsToken.get(token)
}

export function getRegistrationByAsId(asId: string): CompiledRegistration | undefined {
  return registrationsByAsId.get(asId)
}

export function getRegistrationById(id: string): CompiledRegistration | undefined {
  return registrationsById.get(id)
}

export function getRegistrations(): CompiledRegistration[] {
  return Array.from(registrationsById.values())
}

// --- Namespace matching ---

function matchesNamespace(value: string, entries: CompiledNamespaceEntry[]): boolean {
  return entries.some(e => e.regex.test(value))
}

export function findInterestedServices(event: {
  sender: string
  roomId: string
  stateKey?: string | null
}, roomAliases: string[]): CompiledRegistration[] {
  const interested: CompiledRegistration[] = []

  for (const reg of registrationsById.values()) {
    // 1. sender matches users namespace
    if (matchesNamespace(event.sender, reg.namespaces.users)) {
      interested.push(reg)
      continue
    }

    // 2. room_id matches rooms namespace
    if (matchesNamespace(event.roomId, reg.namespaces.rooms)) {
      interested.push(reg)
      continue
    }

    // 3. state_key (if present, looks like @user) matches users namespace
    if (event.stateKey && event.stateKey.startsWith('@') && matchesNamespace(event.stateKey, reg.namespaces.users)) {
      interested.push(reg)
      continue
    }

    // 4. Any alias of the room matches aliases namespace
    if (roomAliases.some(alias => matchesNamespace(alias, reg.namespaces.aliases))) {
      interested.push(reg)
      continue
    }
  }

  return interested
}

export function isUserInExclusiveNamespace(userId: string): CompiledRegistration | undefined {
  for (const reg of registrationsById.values()) {
    for (const entry of reg.namespaces.users) {
      if (entry.exclusive && entry.regex.test(userId)) {
        return reg
      }
    }
  }
  return undefined
}

export function isUserInNamespace(userId: string, reg: CompiledRegistration): boolean {
  return matchesNamespace(userId, reg.namespaces.users)
}

export function ensureAppServiceUser(userId: string): void {
  db.insert(accounts).values({
    id: userId,
    displayname: userId.split(':')[0]!.slice(1),
  }).onConflictDoNothing().run()
}
