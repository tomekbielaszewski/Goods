# Plan: Granular-Event API Client (Path B)

**Branch:** `sync_rework`
**Status:** Executed — merged via PR #7 (test/granular-events → sync_rework). Kept as design record; the implementation is the source of truth.
**Scope:** Frontend only. Backend is slated for a full rewrite and is completely out of scope.

## Context

The frontend currently talks to an in-memory `ApiClient` (`frontend/src/api/client.ts`) whose mutation surface
is entity-shaped (`upsertItem`, `updateShop(id, patch)`, `upsertListItem`, ...). We migrate it to **Path B**:
a named-method facade that internally emits **granular, intent-bearing events**. Reads stay projections over
the client's in-memory Maps, so the event log becomes the single source of truth for all mutations.

The eventual backend (to be rewritten) will consume these events; nothing in this plan depends on backend
endpoints existing. All events, outbox, and state are **in-memory only** for now.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Event granularity | Path B — granular intent events (`ShopRenamed`, `ItemUpdated`, ...) |
| Public facade | Named methods (`apiClient.renameShop(id, name)`), not raw `dispatch` |
| Event fields | `{ id, type, entityId, payload, timestamp, clientId, lamport }` |
| Persistence | None — in-memory only (no localStorage, no IndexedDB) |
| Transport | No abstraction yet — refactor later when the backend is rewritten |
| Real-time channel | Out of scope (SSE deferred; backend doesn't exist yet) |
| Backend | Untouched. `docs/api.md`, `/api/*` endpoints, lamport server — all irrelevant here |

## Out of scope (explicit)

- Any backend code, routes, or Go tests
- localStorage / IndexedDB persistence
- SSE, WebSocket, polling, or any network transport
- Transport abstraction interfaces (`Transport` seam)
- Bug reports / Conflicts screens (already removed on this branch)

---

## Phase 1 — `frontend/src/types/event.ts` (new file)

Granular event union. Shared base envelope:

```ts
interface EventBase {
  id: string            // crypto.randomUUID()
  clientId: string      // per-device UUID, generated once per session (localStorage NOT used; in-memory constant)
  lamport: number       // per-client counter, incremented once per emitted event (max(other, mine) + 1 merge later)
  timestamp: string     // ISO wall-clock, new Date().toISOString()
  entityId: string      // the aggregate this event concerns (item/list/shop/... id)
}
```

`clientId` and `lamport` are stamped now (cheap) so the future backend gets ordering + provenance for free;
they are unused until then.

**`entityId` rule (locked):** `entityId` = the id of the primary aggregate the event mutates:
creates → the new entity's id (`ItemCreated`, `TagCreated`, `ShopCreated`, `ListCreated`, `ListItemAdded`,
`ShoppingSessionStarted`); relation events → the item id (`ShopAssignedToItem`, `ShopRemovedFromItem`,
`TagAssignedToItem`, `TagRemovedFromItem`); list-item events → the listItem id (`ListItemStateChanged`,
`ListItemQuantityChanged`, `ListItemRemoved`, `ShopSkippedForListItem`, `ShopSkipCleared`); session item
events → the session id (`SessionItemBought`, `SessionItemSkipped`); otherwise the entity's own id
(`ShopRenamed`, `ShopColorChanged`, `ShopSoftDeleted`, `TagDeleted`, `ItemUpdated`, `ItemSoftDeleted`,
`ListRenamed`, `ListArchived`, `ListDeleted`).

### Event union

```ts
type AppEvent =
  // Shops
  | ShopCreated      { name: string; color: string }
  | ShopRenamed      { name: string }
  | ShopColorChanged { color: string }
  | ShopSoftDeleted  { deletedAt: string }
  // Tags
  | TagCreated       { name: string }
  | TagDeleted       {}
  // Items
  | ItemCreated      { name: string; unit?: string; defaultQuantity?: number; description?: string; notes?: string }
  | ItemUpdated      { name?: string; unit?: string; defaultQuantity?: number; description?: string; notes?: string }
  | ItemSoftDeleted  { deletedAt: string }
  | ShopAssignedToItem   { shopId: string }
  | ShopRemovedFromItem  { shopId: string }
  | TagAssignedToItem    { tagId: string }
  | TagRemovedFromItem   { tagId: string }
  // Lists
  | ListCreated      { name: string }
  | ListRenamed      { name: string }
  | ListArchived     { archivedAt: string }
  | ListUnarchived   {}
  | ListDeleted      { deletedAt: string }
  // List items
  | ListItemAdded        { listId: string; itemId: string; state: 'active' | 'bought'; quantity?: number; unit?: string; notes?: string }
  | ListItemStateChanged { state: 'active' | 'bought' }
  | ListItemQuantityChanged { quantity: number; unit?: string }
  | ListItemRemoved      {}
  // Skipped shops
  | ShopSkippedForListItem { shopId: string }
  | ShopSkipCleared        { shopId: string }
  // Sessions
  | ShoppingSessionStarted { listId: string; shopId: string }
  | SessionItemBought   { itemId: string; quantity?: number; unit?: string }
  | SessionItemSkipped  { itemId: string }
  // Telemetry (outbox-queued, no projection effect)
  | BugReported         { text: string }
```

Payload-less events carry `{}` payloads so `payload` is always defined.

Note: `deleteShop` and `softDeleteShop` are the same operation today (both set `deletedAt`) — one event type.

### Composite operations

- **`cloneList`** → emits `ListCreated` + N × `ListItemAdded` (one per source list item, copied fields).
- **Item unit change cascade** (currently ItemDetailScreen.tsx:95-104) → emits `ItemUpdated { unit }` +
  one `ListItemQuantityChanged { quantity, unit }` per affected list item (only those whose `unit === oldUnit`).

---

## Phase 2 — `ApiClient` v2 (`frontend/src/api/client.ts`)

### Unchanged (reads — projections over the existing Maps)

`getShops`, `getShop(id)`, `getTags`, `getItemsWithDetails(searchTerm?)`, `getItemWithDetails(id)`,
`getItemsForShop(shopId)`, `getFrequentItems(listId)`, `getLists`, `getList(id)`,
`getListItemsWithItems(listId)`, `getListItemsByItemId(itemId)`, `getSessionItemsByItemId(itemId)`,
`getShoppingSessionsByIds(ids)`, `getSessionItems(sessionId)`, `findOpenSession(listId, shopId)`,
`getItemShopsByShop(shopId)`, `isEmpty()`, `reset()`, and private `enrichItems`.

### New internals

- `private events: AppEvent[]` — the in-memory event log (append-only).
- `private outbox: AppEvent[]` — events not yet "synced" (no-op for now; kept separate so the future
  transport has something to drain).
- `private clientId = crypto.randomUUID()` — session-scoped device id.
- `private lamport = 0` — incremented on every event stamp.
- `private listeners = new Set<(e: AppEvent) => void>()`.
- `private stamp(event): AppEvent` — sets `id`, `clientId`, `lamport: ++lamport`, `timestamp`.
- `private commit(event)` — `stamp` → `applyEvent` → push to `events` + `outbox` → notify listeners.
- `private applyEvent(event)` — applies one event to the Maps (below).
- `reset()` additionally clears `events`, `outbox`, and resets `lamport` to 0.

### Named mutation methods (public surface)

Each method builds the event(s) above, commits them, and returns the affected entity where callers need it:

| Method | Emits | Returns |
|---|---|---|
| `createShop({ name, color })` | `ShopCreated` | `Shop` |
| `renameShop(id, name)` | `ShopRenamed` | `Shop` |
| `changeShopColor(id, color)` | `ShopColorChanged` | `Shop` |
| `softDeleteShop(id)` | `ShopSoftDeleted` | `void` |
| `createTag(name)` | `TagCreated` | `Tag` |
| `deleteTag(id)` | `TagDeleted` | `void` |
| `createItem(input, shopIds, tagIds)` | `ItemCreated` + per-id `ShopAssignedToItem`/`TagAssignedToItem` | `Item` |
| `updateItem(id, patch)` | `ItemUpdated` (only changed fields; **cleared fields included as explicit `undefined`**, e.g. `{ unit: undefined }`) | `Item` |
| `assignShopToItem(itemId, shopId)` | `ShopAssignedToItem` | `void` |
| `removeShopFromItem(itemId, shopId)` | `ShopRemovedFromItem` | `void` |
| `assignTagToItem(itemId, tagId)` | `TagAssignedToItem` | `void` |
| `removeTagFromItem(itemId, tagId)` | `TagRemovedFromItem` | `void` |
| `saveItemShopsAndTags(itemId, shopIds, tagIds)` | per-diff `ShopAssignedToItem`/`ShopRemovedFromItem`, `TagAssignedToItem`/`TagRemovedFromItem` | `void` |
| `softDeleteItem(id)` | `ItemSoftDeleted` | `void` |
| `createList(name)` | `ListCreated` | `List` |
| `renameList(id, name)` | `ListRenamed` | `List` |
| `archiveList(id)` | `ListArchived` | `List` |
| `deleteList(id)` | `ListDeleted` | `void` |
| `cloneList(id)` | `ListCreated` + N × `ListItemAdded` | `List` (the new list) |
| `addListItem({ listId, itemId, state, quantity?, unit?, notes? })` | `ListItemAdded` | `ListItem` |
| `setListItemState(id, state)` | `ListItemStateChanged` | `ListItem` |
| `changeListItemQuantity(id, quantity, unit?)` | `ListItemQuantityChanged` | `ListItem` |
| `removeListItem(id)` | `ListItemRemoved` | `void` |
| `skipShopForListItem(listItemId, shopId)` | `ShopSkippedForListItem` | `void` |
| `clearSkipForListItem(listItemId, shopId)` | `ShopSkipCleared` | `void` |
| `startShoppingSession(listId, shopId)` | `ShoppingSessionStarted` | `ShoppingSession` |
| `recordSessionItem({ sessionId, itemId, action: 'bought'\|'skipped', at, quantity?, unit? })` | `SessionItemBought` or `SessionItemSkipped` | `SessionItem` |

### `applyEvent` semantics (Map-based, replacing entity writes)

- **Entity events** (`Shop*`, `Tag*`, `Item*`, `List*`, `ListItem*`): create → insert map entry;
  update → shallow-merge payload onto existing (**explicit `undefined` payload fields overwrite
  existing values — cleared fields stay cleared**); delete/soft → set `deletedAt` (entities stay in Maps,
  reads filter `deletedAt` — current behavior). `version`/`updatedAt` bumping on each mutation is
  preserved so read callers see identical data.
- **Relation events** (`ShopAssignedToItem`, `TagAssignedToItem`, ...): push/remove from `itemShops` /
  `itemTags` arrays (dedupe on add, current behavior).
- **`ListItemQuantityChanged`**: merge `quantity`/`unit`; `ListItemStateChanged`: merge `state`.
- **Skipped shop events**: push/remove `{ listItemId, shopId, skippedAt }` in `listItemSkippedShops`.
- **`ShoppingSessionStarted`**: insert into `shoppingSessions`.
- **`SessionItemBought`/`SessionItemSkipped`**: insert into `sessionItems`.

### `subscribe(listener: (e: AppEvent) => void): () => void`

In-process pub/sub. `commit` notifies all listeners after applying. Returns an unsubscribe fn.
Currently no remote producers exist; the channel exists so pages/tests can observe the event stream.

### `loadData()` / `isEmpty()`

`loadData()` remains a no-op (in-memory only). `isEmpty()` remains the guard (items map empty).

---

## Phase 3 — `frontend/src/store/useStore.ts`

Actions are reimplemented as thin wrappers over the named methods; **signatures unchanged**:

| Store action | Becomes |
|---|---|
| `addShop(input)` | `apiClient.createShop(input)` → append to `shops` |
| `updateShop(id, patch)` | `renameShop` + `changeShopColor` per key present in `patch` → map `shops` |
| `deleteShop(id)` | `apiClient.softDeleteShop(id)` → filter `shops` |
| `addTag(name)` | `apiClient.createTag(name)` → append to `tags` |
| `upsertItem(item, shopIds, tagIds)` | item exists in store ? `updateItem` + `saveItemShopsAndTags` : `createItem(...)` |
| `addItemToShop(itemId, shopId)` | `apiClient.assignShopToItem(itemId, shopId)` |
| `removeItemFromShop(itemId, shopId)` | `apiClient.removeShopFromItem(itemId, shopId)` |
| `upsertList(list)` | exists ? `renameList` : `createList` |
| `deleteList(id)` | `apiClient.deleteList(id)` → filter `lists` |
| `cloneList(id)` | `apiClient.cloneList(id)` → append `lists` |
| `upsertListItem(li)` | exists ? merge via `setListItemState`/`changeListItemQuantity` : `addListItem` |
| `updateListItemState(id, state)` | `apiClient.setListItemState(id, state)` |
| `skipShopForListItem(liId, shopId)` | `apiClient.skipShopForListItem(liId, shopId)` |
| `clearSkipForListItem(liId, shopId)` | `apiClient.clearSkipForListItem(liId, shopId)` |
| `createShoppingSession(listId, shopId)` | `apiClient.startShoppingSession(listId, shopId)` |
| `recordSessionItem(input)` | `apiClient.recordSessionItem(input)` |
| `loadData()` | unchanged (no-op) |

---

## Phase 4 — Pages (mutation call-site migration; reads untouched)

### `frontend/src/pages/ItemDetailScreen.tsx`
- `save` (line 71): replace `upsertItem(item, shops, tags)` with:
  - new item → `createItem({name, unit, defaultQuantity, description, notes}, selectedShops, selectedTags)`
  - existing → `updateItem(id, {diff of changed fields})` + `saveItemShopsAndTags(id, selectedShops, selectedTags)`
  - unit cascade (line 97-104): `updateItem` (unit) then per affected li `changeListItemQuantity(li.id, li.quantity, newUnit)`
- list-add flow (line 108-119): `addListItem({listId, itemId, state: 'active', quantity, unit})`
- `deleteItem` (line 129): `softDeleteItem(id)`
- `addTag` (line 133-147): `createTag(normalized)` (return value used — keep)

### `frontend/src/pages/ListScreen.tsx`
- line 52 (rename): `renameList(id, name)`
- line 60 (create): `createList(name)`
- line 74-75 (clone): `cloneList(id)` (navigates with `cloned.id` — keep return)
- line 94 (re-add item as active): `setListItemState(existing.id, 'active')`
- line 101 (add new item): `addListItem(...)`
- line 117 (toggle bought/active): `setListItemState(li.id, newState)`
- line 121 (record bought): `recordSessionItem({..., action: 'bought', at: now})`
- line 133 (delete): `removeListItem(li.id)`
- line 138 (quantity/unit change): `changeListItemQuantity(li.id, qty, unit)`
- line 144: `skipShopForListItem(li.id, shoppingModeShopId)`
- line 146 (record skipped): `recordSessionItem({..., action: 'skipped', at: now})`
- line 157: `clearSkipForListItem(li.id, shoppingModeShopId)`
- line 381: `startShoppingSession(listId, shopId)` (line 379 `findOpenSession` read stays)

### `frontend/src/pages/ListsScreen.tsx`
- line 32 (create): `createList(name)`
- line 41 (delete): `deleteList(id)` — **note:** current code reads the list then upserts with `deletedAt`; the named method must produce the same result
- line 48 (archive): `archiveList(id)`

### `frontend/src/pages/SettingsScreen.tsx`
- line 49: `renameShop(editId, name)` + `changeShopColor(editId, color)`
- line 51: `createShop({name, color})`
- line 62: `softDeleteShop(id)`

### `frontend/src/pages/ShopItemsScreen.tsx`
- line 39: `removeShopFromItem(item.id, id)`
- line 42: `assignShopToItem(item.id, id)`

### Untouched (read-only)
`SearchInput.tsx`, `SuggestionsPanel.tsx`, `RepositoryScreen.tsx`.

---

## Phase 5 — TDD workflow (per CLAUDE.md)

1. **test-writer** agent, on branch `test/granular-events`:
   - Rewrite `frontend/src/api/client.test.ts`: per-method tests asserting (a) emitted events
     (`subscribe` capture — types, payloads, `entityId`, lamport monotonicity, clientId stamped),
     (b) projection state after apply (reads unchanged), (c) composite ops (`cloneList` → N+1 events,
     unit cascade), (d) `reset()` clears log/outbox/lamport.
   - Add `frontend/src/types/event.test.ts` (union discriminators) if useful.
   - Update store tests (`useStore.test.ts`) and page tests (`ListScreen.test.tsx`,
     `ItemDetailScreen.test.tsx`, `ListsScreen.test.tsx`, `SettingsScreen.test.tsx`,
     `ShopItemsScreen.test.tsx`) for the new named methods where they mock `apiClient`.
   - Commits tests only. Runs `npm test` and reports failures.
2. **implementer** agent: implements Phases 1-4 until green. Never edits test files.
3. Both run the full suite and report counts.

Note: in this environment `test-writer`/`implementer` subagent types were not registered; the two
roles were executed via `general` agents with strict role constraints (writer commits tests only,
implementer never touches test files).

## Verification

- `npm test` — full frontend suite passes (207 tests at time of execution)
- `npm run typecheck` — no errors (executed via `npx tsc -b`; no `typecheck` script exists)
- No Go changes; backend tests untouched (not run as part of this work)

## Future work (not now)

- Backend rewrite consuming the event log; `fetchRemoteEvents`/`publishPendingEvents` + transport seam
- SSE push channel (`subscribe` wired to the stream)
- Persistence of the event log/outbox (localStorage or IndexedDB)
- Conflict detection and resolution over granular events
