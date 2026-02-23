# Sync Performance Quick Wins

**Date:** 2026-02-18
**Target scale:** 50-500 concurrent users
**Motivation:** Proactive optimization before performance becomes a bottleneck

## Problem

Standard sync (`/sync`) executes ~15 + 4N queries for N joined rooms. For a user in 50 rooms, that's ~215 queries per sync response. Key inefficiencies:

1. Expired typing notifications are deleted once per room (N redundant DELETEs)
2. Typing and room account data are fetched per-room (2N queries that could be 2)
3. Missing indexes on frequently queried columns cause full table scans
4. Default SQLite PRAGMAs are conservative for a server workload

## Changes

### 1. SQLite PRAGMAs (`app/db/index.ts`)

Add after existing PRAGMAs:

```sql
PRAGMA synchronous = NORMAL
PRAGMA cache_size = -64000
PRAGMA mmap_size = 268435456
```

- `synchronous = NORMAL` is safe with WAL mode. Risk: last transaction may be lost on OS crash (not process crash). Acceptable for chat.
- `cache_size = -64000` sets 64MB page cache (default ~2MB).
- `mmap_size = 268435456` enables 256MB memory-mapped I/O for reads.

### 2. Missing Indexes (`app/db/schema.ts`)

| Table | Index | Columns | Justification |
|-------|-------|---------|---------------|
| `accountData` | `account_data_user_room_idx` | `(userId, roomId)` | Sync queries filter by userId + roomId. PK leads with (userId, type, roomId) so userId+roomId lookups can't use it efficiently. |
| `e2eeDeviceListChanges` | `e2ee_device_list_changes_user_idx` | `(userId)` | Filtered by userId for untrusted devices in both sync paths. |

### 3. Typing Cleanup Outside Loop (`app/modules/sync/service.ts`)

Move the `DELETE FROM typing_notifications WHERE expires_at <= ?` from `buildJoinedRoomData()` (runs per-room) to `buildSyncResponse()` (runs once before the loop).

**Before:** N DELETE statements per sync
**After:** 1 DELETE statement per sync

### 4. Batch Typing and Room Account Data (`app/modules/sync/service.ts`)

Extend `prefetchBatchSyncData()` and its `BatchSyncData` interface:

**New batch queries:**
- Typing: `SELECT room_id, user_id FROM typing_notifications WHERE room_id IN (?)`
- Room account data: `SELECT * FROM account_data WHERE user_id = ? AND room_id IN (?)`

**New fields on `BatchSyncData`:**
- `typing: Map<string, string[]>` (roomId -> list of typing userIds)
- `roomAccountData: Map<string, Array<{type: string, content: Record<string, unknown>}>>` (roomId -> account data entries)

`buildJoinedRoomData()` reads from these maps instead of querying per-room.

**Before:** 2N queries (N typing SELECTs + N account data SELECTs)
**After:** 2 queries total

## Impact

For a user in 50 rooms:

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| DELETE queries (typing cleanup) | 50 | 1 | 98% |
| SELECT queries (typing) | 50 | 1 | 98% |
| SELECT queries (room account data) | 50 | 1 | 98% |
| Total queries per sync | ~215 | ~118 | ~45% |
| Query latency (PRAGMAs + indexes) | baseline | -30-50% | cumulative |

## Files Changed

1. `app/db/index.ts` — 3 new PRAGMA statements
2. `app/db/schema.ts` — 2 new index definitions
3. `app/modules/sync/service.ts` — move typing cleanup, extend BatchSyncData, update buildJoinedRoomData

## Out of Scope

- Sliding sync batching (deferred to a future phase)
- Materialized room summaries (premature at this scale)
- State event batching (requires restructuring per-room flow due to `limited` flag dependency)
