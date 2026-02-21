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

bun run db:reset             # Reset database to clean state
bun run env:rebuild          # Reset DB + run migrations
bun run env:rebuild:seed     # Reset + migrate + create test users

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

### Caching System (`app/cache/`)

Unified cache abstraction using `unstorage` — switches between memory (default) and Redis via `IM_CACHE_DRIVER` without code changes. API: `cacheGet<T>()`, `cacheSet(key, value, {ttl})`, `cacheDel()`, `cacheDelPrefix()`.

Cache key conventions use prefixed namespaces: `m:ad:{userId}` (account deactivated), `m:dn:{userId}` (display name), `m:dt:{userId}:{deviceId}` (device trust), `m:rm:{roomId}:{userId}` (membership), `m:rs:{roomId}:{type}:{stateKey}` (room state), `oauth_access_token:{token}`, `account_token:{token}`.

**Negative caching**: cache misses are stored with 60s TTL to prevent repeated DB queries for non-existent entities.

### Model Layer (`app/models/`)

Thin, cache-backed data access layer for frequently-queried entities. One file per entity: `account.ts`, `device.ts`, `roomMembership.ts`, `roomState.ts`, `auth.ts`.

**Convention**: Functions return `null`/`undefined` for "not found" (never throw). Each model implements explicit TTL-based cache with invalidation functions for cache busting. Synchronous DB access wrapped in async cache operations.

**Token resolution** (`auth.ts`): Resolves Bearer tokens in cascade order — AppService → OAuth → Account tokens. Returns typed `ResolvedToken` union with source, userId, deviceId.

**Deferred writes**: Some operations batch DB writes (e.g., account token `lastUsedAt` flushed every 15min via `flushAccountTokenLastUsedAt()`).

### Shared Code

- `app/shared/middleware/` — auth, errors, deviceTrust, rateLimit, requestId, requestLog
- `app/shared/helpers/` — eventQueries, formatEvent, guards, verifyKeys
- `app/shared/validation.ts` — Zod schemas shared across routes
- `app/utils/` — tokens (ULID/nanoid generators), s3, storage

### Auth & Middleware

Auth middleware (`app/shared/middleware/auth.ts`) validates Bearer tokens against three sources in order: AppService tokens, OAuth tokens, then long-lived account tokens. It sets `c.var.auth` (typed as `AuthEnv`) containing `{ userId, deviceId, isGuest, trustState }`. Routes use `Hono<AuthEnv>` as the generic type.

Error responses use Matrix error codes via `matrixError(c, 'M_FORBIDDEN', 'message')` from `app/shared/errors.ts`. Helper shortcuts: `matrixNotFound()`, `matrixForbidden()`, `matrixUnknown()`. Status codes are mapped via `ERROR_STATUS` lookup (e.g., `M_FORBIDDEN` → 403, `M_UNKNOWN_TOKEN` → 401, `M_TOO_LARGE` → 413).

### Device Trust (`app/shared/middleware/deviceTrust.ts`)

Trust states: `'trusted'` (full access), `'unverified'` (restricted), `'blocked'` (denied). Unverified devices can only access: logout, whoami, sync, keys, sendToDevice (verification event types only), pushrules, and cross-signing account data. All other endpoints return `M_FORBIDDEN`.

### Route Patterns

Each route file exports a `new Hono<AuthEnv>()` instance with middleware chaining. Validation uses `validate(c, zodSchema, body)` which returns `{ success, data/response }`:

```typescript
const body = await c.req.json()
const v = validate(c, createRoomBody, body)
if (!v.success) return v.response
const { name, topic } = v.data  // type-safe
```

### Event Storage (Dual-Table)

Events are split into two tables:
- `eventsState` — state events (have `stateKey` for type+key lookup)
- `eventsTimeline` — timeline events (messages, reactions, redactions)
- `currentRoomState` — materialized current state per room

Events use `streamOrder` (auto-increment from events table) for ordering. To-device messages use a separate auto-increment `id` — NOT ULIDs.

### Sync Protocol (`app/modules/sync/`)

- `service.ts` — orchestrates `buildSyncResponse()` with modular collectors
- `collectors/` — independent modules: `accountData.ts`, `deviceLists.ts`, `position.ts`, `presence.ts`, `toDevice.ts`
- `roomData.ts` — room-level data building with `prefetchBatchSyncData()` for batch efficiency
- `trust.ts` — device trust context resolution, filters rooms/events for untrusted devices
- `notifier.ts` — EventEmitter-based in-process notifications (no cross-process pub/sub)
- `slidingRoutes.ts` — MSC3575 sliding sync variant
- Long-poll with 28-second default timeout; `Bun.serve` uses `idleTimeout: 60` to exceed it

### Auth Flow (`app/oauth/`)

Built-in OIDC provider that delegates to an upstream OIDC issuer (login.gid.io). Uses PKCE flow: client → `/oauth/auth` → upstream redirect → callback → issue Matrix tokens. Token types: `AccessToken`, `RefreshToken`, `AuthorizationCode`, `Grant` (logical grouping for cascading invalidation). Fixed client ID `matrix` for all registrations (MSC2965). Supports both stable and MSC2967 device scope prefixes.

Token caching (`app/oauth/accessTokenCache.ts`): TTL computed from expiry (max 3600s), with `primeOAuthAccessTokenCache()` for warming after issue. Invalidation cascades via grant ID.

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
- `IM_CACHE_DRIVER` — `memory` (default) or `redis`; `REDIS_URL` required for redis
- `IM_COOKIE_SECRET` — required in production (startup fails if using dev default)
- `IM_LOG_FORMAT` — `cli` (dev) or `json` (production); `IM_LOG_LEVEL` — default: debug (dev), info (prod)
- `S3_*` — optional object storage; falls back to local disk (`data/media/`)
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
| Any non-trivial task (3+ steps or multi-file changes) | **Project Task Tracking** — 读取 `task.md` → `TaskCreate` 同步到会话 → 完成后写回 `task.md` |

### Priority Order

1. **Process skills first** (brainstorming, debugging) — determines HOW to approach
2. **Implementation skills second** (TDD, executing-plans) — guides execution
3. **Completion skills last** (verification, code-review) — validates results

### Project Task Tracking (Mandatory)

持久化任务文件: `task.md`（项目根目录）。所有任务必须在此文件中记录并与会话工具同步。

#### 会话开始

1. **读取 `task.md`** — 了解当前项目状态、进行中任务、待办优先级
2. **同步到会话** — 将本次要处理的任务用 `TaskCreate` 创建会话级任务
3. **认领任务** — 从 `task.md` 的「待办」中选择任务，优先处理 P0 > P1 > P2 > P3

#### 工作进行中

1. **标记状态** — 开始前 `TaskUpdate` 设 `in_progress`，同时更新 `task.md` 中对应项为 `[-]`
2. **拆分子任务** — 复杂任务拆分为子任务，用 `TaskCreate` 创建并在 `task.md` 中缩进记录
3. **依赖关系** — 用 `TaskUpdate` 的 `addBlockedBy`/`addBlocks` 表达依赖，`task.md` 中用 `blocked by: #描述` 标注
4. **新发现的任务** — 工作中发现的新任务立即追加到 `task.md` 对应优先级分类下

#### 任务完成

1. **标记完成** — `TaskUpdate` 设 `completed`，同时更新 `task.md` 中对应项为 `[x]` 并移到「已完成」
2. **更新日期** — 修改 `task.md` 顶部的更新日期

#### 会话结束

1. **同步回 `task.md`** — 将所有会话中的任务状态变更写回 `task.md`
2. **未完成任务** — 保留在「进行中」或「待办」，确保下次会话可以继续

#### task.md 状态标记

| 标记 | 含义 | 对应 TaskUpdate status |
|------|------|----------------------|
| `[ ]` | 待办 | `pending` |
| `[-]` | 进行中 | `in_progress` |
| `[x]` | 已完成 | `completed` |
| `[~]` | 关闭/不做 | — |

#### task.md 优先级

| 标签 | 含义 |
|------|------|
| `P0` | 阻塞性问题，立即处理 |
| `P1` | 高优先级，当前迭代 |
| `P2` | 中优先级，下个迭代 |
| `P3` | 低优先级，待规划 |

### Non-Negotiable Rules

- **No production code without a failing test first** (TDD)
- **No fixes without root cause investigation** (systematic debugging)
- **No completion claims without fresh verification evidence** (verification)
- **No implementation without design approval** (brainstorming → writing-plans)
- **No multi-step work without task tracking** — 必须读取 `task.md`，同步会话任务，完成后写回
- If even 1% chance a skill applies, invoke it — don't rationalize skipping
