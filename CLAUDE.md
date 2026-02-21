# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**gim** is a Matrix protocol homeserver built with Hono + Bun + Drizzle ORM + SQLite. It implements Matrix client-server API including E2EE (Olm/Megolm), sync (long-poll), SSO authentication, media storage, and an admin panel.

## Commands

```bash
bun run dev                  # Start dev server with hot reload (port 3000)
bun run start                # Run server (no bundling)

bun run lint                 # ESLint check
bun run lint:fix             # ESLint auto-fix

bun test                     # Run all tests (Bun test runner)
bun test tests/rooms.test.ts # Run a single test file

bun run db:generate          # Generate Drizzle migrations
bun run db:migrate           # Run Drizzle migrations
bun run db:push              # Push schema directly to DB (dev)
bun run db:studio            # Visual DB browser on :3000

bun run admin:dev            # Admin panel dev server (port 5173, proxies API to :3000)
bun run admin:build          # Build admin panel to admin/dist/

bun run examples:setup       # Create test users (alice, bob), saves tokens to examples/.tokens.json
bun run examples:test        # Run all integration examples against running server
bun run admin:create @user:server  # Grant admin role to a user
```

## Code Style

- **ESLint:** @antfu/eslint-config — no semicolons, single quotes
- **Path alias:** `@/*` maps to `app/*`
- **Module system:** ESM (`"type": "module"`)
- **TypeScript:** strict mode, `noUncheckedIndexedAccess: true`
- **Validation:** Zod for all request body/param validation

## Architecture

### Server (`app/`)

- **Entry:** `app/index.ts` — Hono app with middleware stack, route mounting, graceful shutdown
- **Config:** `app/config.ts` — all env vars with defaults (prefix: `IM_*`, `S3_*`, `DB_PATH`)
- **Database:** `app/db/schema.ts` (Drizzle schema), `app/db/index.ts` (SQLite with WAL mode)
- **Logging:** `app/global.ts` — Winston logger, `cli` format in dev, `json` in production

### Module Pattern

Each feature lives in `app/modules/{feature}/` with individual route files exported from `index.ts`. Larger modules split routes into separate files (e.g., `keysUploadRoute.ts`, `keysQueryRoute.ts`), while simpler ones may combine routes. Business logic lives in `service.ts` when needed.

Modules: `account`, `admin`, `appservice`, `auth`, `device`, `e2ee`, `media`, `message`, `notification`, `presence`, `room`, `server`, `sync`, `thread`, `voip`

### Shared Code

- `app/shared/middleware/` — auth, errors, rateLimit, requestId, requestLog
- `app/shared/helpers/` — eventQueries, formatEvent, guards, verifyKeys
- `app/shared/validation.ts` — Zod schemas shared across routes
- `app/utils/` — tokens (ULID/nanoid generators), s3, storage

### Auth & Middleware

Auth middleware (`app/shared/middleware/auth.ts`) validates Bearer tokens against three sources in order: AppService tokens, OAuth tokens, then long-lived account tokens. It sets `c.var.auth` (typed as `AuthEnv`) containing `{ userId, deviceId, isGuest, trustState }`. Routes use `Hono<AuthEnv>` as the generic type.

Error responses use Matrix error codes via `matrixError(c, 'M_FORBIDDEN', 'message')` from `app/shared/errors.ts`. Helper shortcuts: `matrixNotFound()`, `matrixForbidden()`, `matrixUnknown()`.

### Event Storage (Dual-Table)

Events are split into two tables:
- `eventsState` — state events (have `stateKey` for type+key lookup)
- `eventsTimeline` — timeline events (messages, reactions, redactions)
- `currentRoomState` — materialized current state per room

Events use `streamOrder` (auto-increment from events table) for ordering. To-device messages use a separate auto-increment `id` — NOT ULIDs.

### Sync Protocol (`app/modules/sync/`)

- `notifier.ts` — EventEmitter-based in-process notifications (no cross-process pub/sub)
- `service.ts` — builds delta response from since-token
- Long-poll with 28-second default timeout
- Sliding sync variant: `slidingRoutes.ts` (MSC3575)
- `Bun.serve` uses `idleTimeout: 60` to exceed the sync long-poll timeout

### Auth Flow (`app/oauth/`)

Built-in OIDC provider that delegates to an upstream OIDC issuer (login.gid.io). Issues JWT access/refresh tokens. Auth middleware in `app/shared/middleware/auth.ts` validates Bearer tokens against both OAuth tokens and long-lived account tokens.

### Cron Jobs (`app/cron.ts`)

Scheduled cleanup: orphaned E2EE keys (6h), expired tokens (6h), media deletions (5min), presence expiry (1min).

### Admin Panel (`admin/`)

Separate Vite + React 19 + TanStack Router/Query + Tailwind v4 SPA. Dev server on port 5173 proxies `/admin/api` to the main server. Production build served as static files at `/admin/`.

### Tests & Examples

- `tests/` — BDD tests using Bun's test runner, require running server + `examples:setup`
- `examples/` — 10 integration scripts demonstrating each API area, run sequentially with `examples:test`
- `examples/client.ts` — lightweight Matrix client wrapper used by tests and examples
- Tests load tokens from `examples/.tokens.json` via `loadTokens()` — run `examples:setup` first

## E2EE Critical Notes

- To-device message ordering MUST use auto-increment `id`, not ULIDs
- When identity keys change: clear OTKs, fallback keys, cross-signing keys, stale to-device messages, AND reset `lastToDeviceStreamId`
- `notifyUser()` must be called for device list changes AND to-device message recipients
- `bun --hot` may not pick up all changes — restart server for E2EE fixes

## Environment

Key env vars (see `app/config.ts` and `.env.example` for full list):
- `IM_SERVER_NAME` — Matrix server domain (default: `localhost`)
- `IM_OIDC_ISSUER`, `IM_OIDC_CLIENT_ID`, `IM_OIDC_CLIENT_SECRET` — upstream OIDC
- `DB_PATH` — SQLite file (default: `data/gim.db`)
- `IM_CACHE_DRIVER` — `memory` (default) or `redis`
- `S3_*` — optional object storage; falls back to local disk
- `IM_TURN_URIS`, `IM_TURN_SHARED_SECRET` — VoIP/TURN config
- `IM_AS_REGISTRATION_DIR` — AppService registration YAML directory

## Workflow (Superpowers Skills)

This project follows a strict skill-driven workflow. Invoke the relevant `superpowers:*` skill via the Skill tool **before** taking action. These are not optional — if a skill applies, use it.

### Skill Trigger Rules

| Trigger | Skill to invoke |
|---------|----------------|
| Any creative work: new feature, component, or behavior change | `superpowers:brainstorming` → then `superpowers:writing-plans` |
| Multi-step implementation from a spec/requirement | `superpowers:writing-plans` |
| Executing a written plan | `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents available) |
| Implementing any feature or bugfix | `superpowers:test-driven-development` — write failing test first, always |
| Any bug, test failure, or unexpected behavior | `superpowers:systematic-debugging` — root cause before fixes |
| About to claim work is done, commit, or create PR | `superpowers:verification-before-completion` — evidence before assertions |
| Completed a major step, ready for review | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |
| 2+ independent tasks that can run in parallel | `superpowers:dispatching-parallel-agents` |
| Feature work complete, ready to merge/PR | `superpowers:finishing-a-development-branch` |
| Any non-trivial task (3+ steps or multi-file changes) | **Project Task Tracking** — use `TaskCreate` to create tasks, `TaskUpdate` to track progress |

### Priority Order

1. **Process skills first** (brainstorming, debugging) — determines HOW to approach
2. **Implementation skills second** (TDD, executing-plans) — guides execution
3. **Completion skills last** (verification, code-review) — validates results

### Project Task Tracking (Mandatory)

For any non-trivial task (3+ steps, multi-file changes, or complex logic), you **MUST** use the project task system:

1. **Before starting work:** Use `TaskCreate` to break the work into discrete, trackable tasks with clear subjects and descriptions
2. **While working:** Use `TaskUpdate` to mark tasks `in_progress` before starting and `completed` when done
3. **Track progress:** Use `TaskList` to review overall progress and find next tasks
4. **Dependencies:** Use `TaskUpdate` with `addBlockedBy`/`addBlocks` to express task ordering

This ensures visibility into progress, prevents skipped steps, and enables parallel work delegation. Do NOT skip task tracking even for "obvious" multi-step work.

### Non-Negotiable Rules

- **No production code without a failing test first** (TDD)
- **No fixes without root cause investigation** (systematic debugging)
- **No completion claims without fresh verification evidence** (verification)
- **No implementation without design approval** (brainstorming → writing-plans)
- **No multi-step work without task tracking** (project tasks) — break work into tasks, track progress
- If even 1% chance a skill applies, invoke it — don't rationalize skipping
