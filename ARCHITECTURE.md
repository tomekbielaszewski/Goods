# Grocery App — Architecture

## Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend language | Go | Developer preference; single binary deployment |
| Backend HTTP | `chi` router | Lightweight, idiomatic Go, no magic |
| Backend DB | SQLite via `modernc.org/sqlite` | Pure Go, no CGO, easy cross-compilation |
| Frontend | React + Vite | Most AI training data, fast dev tooling |
| Frontend styling | Tailwind CSS | Utility-first, compact UI easy to achieve |
| Client storage | Dexie.js (IndexedDB) | Relational-enough, offline-first, async |
| Deployment | Home server, single binary | Go serves both API and static React build |

---

## Repository Layout

```
/
├── backend/
│   ├── main.go
│   ├── db/
│   │   ├── schema.sql
│   │   └── queries.sql          # sqlc-generated or hand-written
│   ├── handlers/
│   ├── sync/                    # sync + conflict resolution logic
│   └── grocery.db               # runtime SQLite file (gitignored)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/               # React state (Zustand or Context)
│   │   ├── db/                  # Dexie schema + queries
│   │   └── sync/                # sync client logic
│   └── dist/                    # built assets, served by Go
├── REQUIREMENTS.md
└── ARCHITECTURE.md
```

The Go binary embeds the `frontend/dist` directory at build time (`//go:embed`) so deployment is a single file + the SQLite database.

---

## Data Schema (SQLite)

```sql
-- User-defined shops
CREATE TABLE shops (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,           -- hex colour for UI dots
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME                  -- soft delete
);

-- Global item catalog
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  unit        TEXT,           -- preferred unit (hint for list_items)
  description TEXT,
  notes       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL,
  deleted_at  DATETIME
);
-- quantity lives only in list_items (how much to buy on a specific list)

-- Item ↔ shop associations (many-to-many)
CREATE TABLE item_shops (
  item_id TEXT NOT NULL REFERENCES items(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  PRIMARY KEY (item_id, shop_id)
);

-- User-defined tags
CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Item ↔ tag associations
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id),
  tag_id  TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (item_id, tag_id)
);

-- Named lists
CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME
);

-- Item membership + state within a list
CREATE TABLE list_items (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  state      TEXT NOT NULL DEFAULT 'active',  -- active | bought
  quantity   REAL,
  unit       TEXT,
  notes      TEXT,
  version    INTEGER NOT NULL DEFAULT 1,
  added_at   DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE(list_id, item_id)
);

-- Shops temporarily skipped for an item on a specific list.
-- An item can have multiple shops skipped independently.
-- A row here means: "don't show this item when shopping at this shop on this list".
-- Removed when the user re-activates the item or explicitly clears the skip.
CREATE TABLE list_item_skipped_shops (
  list_item_id TEXT NOT NULL REFERENCES list_items(id),
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  skipped_at   DATETIME NOT NULL,
  PRIMARY KEY (list_item_id, shop_id)
);

-- Shopping sessions (one per trip)
CREATE TABLE shopping_sessions (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id),
  shop_id    TEXT NOT NULL REFERENCES shops(id),
  started_at DATETIME NOT NULL,
  ended_at   DATETIME,
  version    INTEGER NOT NULL DEFAULT 1
);

-- Per-session item events — the source of truth for all item stats.
-- Derived per item:
--   times bought:  COUNT(*) WHERE item_id=? AND action='bought'
--   last bought:   MAX(at)  WHERE item_id=? AND action='bought'
--   where bought:  JOIN shopping_sessions ON session_id → shop_id
--   total amount:  SUM(quantity) WHERE item_id=? AND action='bought'
--   frequency:     times_bought / days_since_first_purchase
CREATE TABLE session_items (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES shopping_sessions(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  action     TEXT NOT NULL,   -- bought | skipped
  quantity   REAL,
  unit       TEXT,
  at         DATETIME NOT NULL
);
```

---

## API

No authentication. All endpoints return / accept JSON.

```
GET  /api/bootstrap          Full data dump (initial load or forced refresh)
POST /api/sync               Bidirectional delta sync (see below)
```

Static assets (React build) served from `/` by Go's embedded file server.

---

## Sync Protocol

### Bootstrap (first load / forced refresh)

Client requests `/api/bootstrap` → server returns everything:

```json
{
  "shops":    [...],
  "tags":     [...],
  "items":    [...],
  "lists":    [...],
  "list_items": [...],
  "server_time": "2026-04-07T10:00:00Z"
}
```

Client writes all records to Dexie, stores `last_synced_at = server_time`.

---

### Delta Sync

Triggered on: app load (if already bootstrapped), window `online` event, periodic background check (every 60 s while online).

```
POST /api/sync
```

**Request** (client → server):

```json
{
  "last_synced_at": "2026-04-07T09:55:00Z",
  "changes": {
    "shops":                   [{ "id": "...", "version": 3, ...all fields... }],
    "items":                   [...],
    "lists":                   [...],
    "list_items":              [...],
    "list_item_skipped_shops": [...]
  }
}
```

Client sends every entity whose local `updated_at > last_synced_at`.

**Response** (server → client):

```json
{
  "server_time": "2026-04-07T10:00:00Z",
  "applied":   ["id1", "id2"],        // client changes accepted
  "conflicts": [                       // same entity changed on both sides
    {
      "entity": "item",
      "id": "abc",
      "client": { ...client version... },
      "server": { ...server version... }
    }
  ],
  "server_changes": {                  // entities changed on server since last_synced_at
    "items":                   [...],
    "lists":                   [...],
    "list_items":              [...],
    "list_item_skipped_shops": [...]
  }
}
```

**Client-side sync logic:**

1. Apply `server_changes` to Dexie (non-conflicting updates from server)
2. For `applied` ids: mark local entities as synced
3. For `conflicts`: queue them in a local `pending_conflicts` Dexie table
4. Update `last_synced_at = server_time`
5. Show sync indicator (spinner → checkmark)
6. If `conflicts.length > 0`: show non-blocking toast *"2 conflicts need review"*

**Server-side sync logic:**

1. For each client change: compare client `version` against DB `version`
   - If `client.version >= db.version` → apply (client is newer or equal), increment version
   - If both changed since `last_synced_at` → conflict, do not apply, return in `conflicts`
2. Collect all server entities with `updated_at > last_synced_at`, return in `server_changes`

---

## Conflict Resolution UI

A dedicated **Conflicts** screen (accessible via toast or settings). For each conflict:

- Side-by-side diff of changed fields
- Three options: **Keep mine**, **Use server version**, **Edit manually**
- Resolved conflicts are synced immediately
- Unresolved conflicts persist in `pending_conflicts` until the user addresses them

Since this is a single-user app, conflicts are rare (only when editing on two devices simultaneously or after an unusually long offline period). The UI can be minimal — a simple list of differing fields with radio buttons.

---

## Offline Behaviour

- All reads and writes go to Dexie first; the server is never on the critical path for UI interactions
- Writes are queued in a `pending_sync` table in Dexie; synced when online
- `navigator.onLine` and the `online` / `offline` events drive sync scheduling
- A small persistent status bar indicator shows: online+synced ✓ | syncing ↻ | offline ○

---

## Deployment

Containerised with Docker; fits the home server's existing multi-service setup. SQLite file is bind-mounted from the host so data survives container restarts and rebuilds.

**Dockerfile** (multi-stage):

```dockerfile
# Stage 1: build frontend
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: build Go binary (embeds frontend/dist)
FROM golang:1.23-alpine AS backend
WORKDIR /app
COPY backend/go.* ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN go build -o grocery .

# Stage 3: minimal runtime image
FROM alpine:3.20
WORKDIR /app
COPY --from=backend /app/grocery .
EXPOSE 8080
CMD ["./grocery", "--db", "/data/grocery.db", "--port", "8080"]
```

**docker-compose.yml** (excerpt):

```yaml
services:
  grocery:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - /srv/grocery:/data     # host path → SQLite lives here
    restart: unless-stopped
```

**Backup**: daily `cp /srv/grocery/grocery.db /srv/grocery/backups/grocery-$(date +%F).db` via cron; SQLite's WAL mode ensures consistent copies without locking.

---

## What Is Deferred

- Authentication / multi-user
- Photo attachments (schema ready: add `photo_url TEXT` to `items` when needed)
