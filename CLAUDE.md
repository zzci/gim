# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**gim** is a Matrix protocol server implementation built with **Hono** (web framework) on **Bun** runtime. It implements a subset of the Matrix Client-Server API, proxies some endpoints to external services, and serves the Element web client as its frontend.

## Commands

```bash
bun install          # Install dependencies
bun dev              # Dev server with hot reload (bun --hot app/index.ts)
bun run build        # Build to dist/
bun start            # Build then run dist/index.js
bun run compile      # Compile to standalone binary
bun run lint         # ESLint check
bun run lint:fix     # ESLint auto-fix
bun run s3           # Upload files to Cloudflare R2
```

## Architecture

### Entry Point & Configuration

- `app/index.ts` — Hono app setup, logging middleware, HTTP server on configurable host:port (default `0.0.0.0:3000`)
- `app/config.ts` — Environment-driven config: `IM_PORT`, `IM_HOST`, `IM_SERVER_NAME`
- `app/global.ts` — Global declarations: `storage` (Unstorage), `logger` (Winston), `isDebug`, `sleep`

### Route Organization

Routes are feature-grouped under `app/routes/`. Each module exports a Hono sub-app that gets mounted in `app/routes/index.ts`:

- **`server/`** — Server discovery (`.well-known`), capabilities, versions, Swagger UI at `/api`
- **`auth/`** — OpenID auth metadata (proxied from `login.gid.io`), OAuth2 client registration
- **`account/`** — `whoami`, user filters, push notification rules
- **`room/`** — Sync endpoint (initial sync + long-poll pattern)
- **`e2ee/`** — Key upload/query, Megolm backup versioning
- **`device/`** — Device management (stub)
- **`app.ts`** — Proxies Element web client from `matrix-web.g.im` CDN
- **`empty.ts`** — Catch-all returning `{}` for unimplemented Matrix endpoints

### Key Patterns

- **Path alias**: `@/*` maps to `app/*` (configured in tsconfig.json)
- **Many endpoints return hardcoded/mock data** (user `@roy:a.g.im`) — this is a work-in-progress implementation
- **Proxying**: Several endpoints proxy to external services (`a.g.im`, `login.gid.io`, `matrix-web.g.im`)
- **Storage**: Uses Unstorage abstraction (`app/utils/storage.ts`) for data persistence
- **Logging**: Winston with CLI format; access logger filters for requests containing 'matrix'

### External Services

- **S3/R2**: Cloudflare R2 via AWS SDK for file uploads (`tools/s3-upload.ts`)
- **Element Web**: Proxied from `https://matrix-web.g.im/element-v1.11.101`

## Code Style

- ESLint with `@antfu/eslint-config` — no semicolons, single quotes, trailing commas
- Prettier: 100 char width, 2-space indent
- `third/` directory is excluded from linting

## Environment Variables

See `.env.example`: `NODE_ENV`, `S3_ACCOUNT_ID`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
