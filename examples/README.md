# gim Examples

Demo scripts that exercise the Matrix Client-Server API against a local gim server.

Uses a lightweight fetch wrapper (`client.ts`) instead of matrix-js-sdk, since the SDK's Rust crypto (wasm) is incompatible with Bun.

## Prerequisites

1. Start the gim server:

```bash
bun dev
```

2. Run setup to create test users and obtain tokens:

```bash
bun run examples/setup.ts
```

This creates `@alice:localhost` (admin) and `@bob:localhost`, exchanges login tokens for access tokens, and writes `.tokens.json`.

## Running Examples

Run all examples sequentially:

```bash
bun run examples:test
```

Or run individually:

```bash
bun run examples/01-sync.ts
bun run examples/02-rooms.ts
bun run examples/03-messages.ts
bun run examples/04-state.ts
bun run examples/05-e2ee-keys.ts
bun run examples/06-admin.ts
```

## Scripts

| Script | Description |
|--------|-------------|
| `setup.ts` | Create test users, issue tokens |
| `01-sync.ts` | Initial + incremental sync |
| `02-rooms.ts` | Room lifecycle: create, invite, join, leave, members |
| `03-messages.ts` | Send, paginate, get event, redact |
| `04-state.ts` | State events, aliases, profile |
| `05-e2ee-keys.ts` | Device keys upload, query, OTK claim |
| `06-admin.ts` | Admin API endpoints |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GIM_URL` | `http://localhost:3000` | Server base URL |
| `IM_SERVER_NAME` | `localhost` | Matrix server name |
| `DB_PATH` | `data/gim.db` | SQLite database path |
