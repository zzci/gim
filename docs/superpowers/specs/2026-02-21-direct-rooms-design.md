# Direct Rooms (DM) Support Design

> Date: 2026-02-21

## Problem

When a room is created with `is_direct: true` and users are invited, the invite `m.room.member` events do not carry the `is_direct` field. This means invited users' clients (e.g. Element) cannot detect that the room is a DM and won't auto-update their `m.direct` account data.

## Approach

Follow Matrix spec: the server includes `is_direct: true` in invite membership event content. Clients manage their own `m.direct` account data.

## Changes

### 1. `app/modules/room/service.ts` — `createRoom()`

When `isDirect: true`, the invite `m.room.member` events must include `is_direct: true` in their content:

```typescript
content: {
  membership: 'invite',
  ...(opts.isDirect ? { is_direct: true } : {}),
}
```

### 2. `app/modules/room/membershipRoutes.ts` — `POST /:roomId/invite`

Accept optional `is_direct` in the request body. Pass it through to the invite event content. Update the Zod validation schema to allow `is_direct: z.boolean().optional()`.

### 3. Validation schema

Add `is_direct` to the `membershipBody` Zod schema in `app/shared/validation.ts`.

## Out of Scope

- Server-side `m.direct` account data management (client responsibility per spec)
- Changes to sync response structure (clients use `m.direct` account data)
- Changes to sliding sync (already supports `is_dm` filter via `rooms.isDirect`)
