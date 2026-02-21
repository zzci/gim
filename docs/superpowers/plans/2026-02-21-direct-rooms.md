# Direct Rooms (DM) Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `is_direct: true` propagate through invite events so clients can detect DM rooms and manage their own `m.direct` account data.

**Architecture:** Two small changes — (1) `createRoom()` passes `is_direct` into invite event content, (2) the standalone invite endpoint accepts and passes `is_direct`. Both follow Matrix spec where the server sets the field on invite membership events and clients read it to maintain `m.direct`.

**Tech Stack:** Hono, Zod, Bun test runner, existing MatrixClient test helper

---

## Chunk 1: Implementation

### Task 1: Write failing tests for direct room support

**Files:**
- Create: `tests/direct-rooms.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, test } from 'bun:test'
import { getAlice, getBob } from './helpers'

describe('Direct Rooms', () => {
  test('createRoom with is_direct includes is_direct in invite event content', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({
      is_direct: true,
      invite: [b.userId],
    })
    expect(room.room_id).toMatch(/^!/)

    // Check the invite member event has is_direct: true
    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('createRoom without is_direct does NOT include is_direct in invite', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({
      invite: [b.userId],
    })

    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBeUndefined()

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('standalone invite endpoint passes is_direct to event content', async () => {
    const a = await getAlice()
    const b = await getBob()

    const room = await a.createRoom({ is_direct: true })

    // Use raw request to pass is_direct in invite body
    await a.request(
      'POST',
      `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/invite`,
      { user_id: b.userId, is_direct: true },
    )

    const members = await a.getMembers(room.room_id)
    const bobInvite = members.chunk.find(
      (e: any) => e.state_key === b.userId && e.content.membership === 'invite',
    )
    expect(bobInvite).toBeTruthy()
    expect(bobInvite.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })

  test('Bob sees is_direct in invite via sync', async () => {
    const a = await getAlice()
    const b = await getBob()

    // Get Bob's initial sync position
    const initialSync = await b.sync({ timeout: 0 })
    const since = initialSync.next_batch

    // Alice creates direct room with Bob invited
    const room = await a.createRoom({
      is_direct: true,
      invite: [b.userId],
    })

    // Bob syncs and should see the invite with is_direct
    const sync = await b.sync({ since, timeout: 1000 })
    const inviteRooms = sync.rooms?.invite || {}
    const inviteRoom = inviteRooms[room.room_id]
    expect(inviteRoom).toBeTruthy()

    const memberEvent = inviteRoom.invite_state.events.find(
      (e: any) => e.type === 'm.room.member' && e.state_key === b.userId,
    )
    expect(memberEvent).toBeTruthy()
    expect(memberEvent.content.is_direct).toBe(true)

    await b.joinRoom(room.room_id)
    await a.leaveRoom(room.room_id)
    await b.leaveRoom(room.room_id)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/direct-rooms.test.ts`
Expected: Tests 1, 3, 4 FAIL (is_direct not present in invite content). Test 2 should PASS.

### Task 2: Add is_direct to invite events in createRoom

**Files:**
- Modify: `app/modules/room/service.ts:203-215` (invite loop)

- [ ] **Step 3: Update createRoom invite content**

In `app/modules/room/service.ts`, change the invite loop (lines 203-215) from:

```typescript
    for (const userId of opts.invite) {
      await createEvent({
        roomId,
        sender: opts.creatorId,
        type: 'm.room.member',
        stateKey: userId,
        content: {
          membership: 'invite',
        },
      })
    }
```

To:

```typescript
    for (const userId of opts.invite) {
      await createEvent({
        roomId,
        sender: opts.creatorId,
        type: 'm.room.member',
        stateKey: userId,
        content: {
          membership: 'invite',
          ...(opts.isDirect ? { is_direct: true } : {}),
        },
      })
    }
```

- [ ] **Step 4: Run tests to verify tests 1, 2, 4 pass**

Run: `bun test tests/direct-rooms.test.ts`
Expected: Tests 1, 2, 4 PASS. Test 3 still FAILS (standalone invite).

### Task 3: Add is_direct support to standalone invite endpoint

**Files:**
- Modify: `app/shared/validation.ts:31-34` (membershipBody schema)
- Modify: `app/modules/room/membershipRoutes.ts:108-114` (invite handler)

- [ ] **Step 5: Update membershipBody Zod schema**

In `app/shared/validation.ts`, change `membershipBody` from:

```typescript
export const membershipBody = z.object({
  user_id: matrixUserId,
  reason: z.string().max(1024).optional(),
}).passthrough()
```

To:

```typescript
export const membershipBody = z.object({
  user_id: matrixUserId,
  reason: z.string().max(1024).optional(),
  is_direct: z.boolean().optional(),
}).passthrough()
```

- [ ] **Step 6: Update invite handler to pass is_direct**

In `app/modules/room/membershipRoutes.ts`, change the invite createEvent call (lines 108-114) from:

```typescript
  await createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: { membership: 'invite' },
  })
```

To:

```typescript
  await createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: {
      membership: 'invite',
      ...(v.data.is_direct ? { is_direct: true } : {}),
    },
  })
```

- [ ] **Step 7: Run all direct room tests**

Run: `bun test tests/direct-rooms.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 8: Run full test suite to check for regressions**

Run: `bun test`
Expected: All existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add tests/direct-rooms.test.ts app/modules/room/service.ts app/modules/room/membershipRoutes.ts app/shared/validation.ts
git commit -m "feat: propagate is_direct in invite events for DM room support"
```
