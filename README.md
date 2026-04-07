# Grocery

Offline-first grocery management app. Works fully in the browser after the first load — no internet required while
shopping. Syncs with a home server in the background when connectivity is available.

**Stack:** Go + SQLite (backend) · React + Tailwind + Dexie (frontend) · Docker (deployment)

---

## Prerequisites

| Tool             | Version    | Notes               |
|------------------|------------|---------------------|
| Go               | ≥ 1.25     | `go version`        |
| Node.js          | ≥ 22       | `node --version`    |
| Docker + Compose | any recent | for deployment only |

---

## Project structure

```
.
├── backend/
│   ├── main.go                  # Entry point — Chi router, embedded frontend
│   ├── db/
│   │   ├── schema.sql           # SQLite schema (all 11 tables)
│   │   └── db.go                # Open DB, apply schema, WAL mode
│   ├── handlers/
│   │   ├── bootstrap.go         # GET /api/bootstrap
│   │   ├── sync.go              # POST /api/sync
│   │   ├── helpers_test.go      # Shared test helpers
│   │   ├── bootstrap_test.go
│   │   └── sync_test.go
│   ├── models/models.go         # Go structs + sync/bootstrap types
│   └── sync/
│       ├── resolver.go          # Conflict detection logic
│       └── resolver_test.go
├── frontend/
│   ├── src/
│   │   ├── types/index.ts       # TypeScript interfaces (mirrors DB schema)
│   │   ├── db/
│   │   │   ├── schema.ts        # Dexie (IndexedDB) database + tables
│   │   │   └── queries.ts       # All DB query functions
│   │   ├── store/useStore.ts    # Zustand — sync state, shopping mode, sort prefs
│   │   ├── sync/syncClient.ts   # Bootstrap + delta sync + background scheduling
│   │   ├── components/          # ItemCard, ShopDot, TagBadge, SortToggle, …
│   │   ├── pages/               # ListsScreen, ListScreen, RepositoryScreen, …
│   │   └── test/setup.ts        # Vitest setup (jest-dom + fake-indexeddb)
│   ├── vite.config.ts
│   └── tailwind.config.js
├── Dockerfile                   # Multi-stage: Node → Go → Alpine
├── docker-compose.yml
└── .dockerignore
```

---

## Development

### 1. Backend

```bash
cd backend

# Install / tidy dependencies
go mod tidy

# Run the server (hot-reloads source on next request with go run)
go run . --db ./grocery.db --port 8080

# Or build and run the binary
go build -o grocery .
./grocery --db ./grocery.db --port 8080
```

Flags:

| Flag     | Default        | Description                  |
|----------|----------------|------------------------------|
| `--db`   | `./grocery.db` | Path to SQLite database file |
| `--port` | `8080`         | HTTP listen port             |

The database file is created automatically on first run. Schema migrations are applied via `CREATE TABLE IF NOT EXISTS`
on every start.

### 2. Frontend

```bash
cd frontend

# Install dependencies (first time only)
npm install

# Start dev server — proxies /api/* to localhost:8080
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies all `/api` requests to the Go backend,
so both must be running simultaneously during development.

### 3. Typical dev workflow

```bash
# Terminal 1 — backend
cd backend && go run . --db ./grocery.db

# Terminal 2 — frontend
cd frontend && npm run dev
```

---

## Testing

### Backend

```bash
cd backend

# Run all tests (unit + integration)
go test ./...

# Verbose output
go test -v ./...

# Single package
go test ./handlers/...
go test ./sync/...

# With race detector
go test -race ./...
```

Tests use a real in-memory SQLite database (`:memory:`) — no mocks for the data layer. Each test gets a fresh DB
instance.

**Coverage:**

- `sync/resolver_test.go` — unit tests for conflict detection logic
- `handlers/bootstrap_test.go` — integration tests for `GET /api/bootstrap`
- `handlers/sync_test.go` — integration tests for `POST /api/sync` (upsert, conflict, server changes)

### Frontend

```bash
cd frontend

# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npx vitest

# With coverage report
npm run test:coverage
```

Tests use `happy-dom` as the browser environment and `fake-indexeddb` for IndexedDB — no real browser or network
required.

**Coverage:**

- `store/useStore.test.ts` — Zustand store actions
- `db/queries.test.ts` — Dexie integration tests (fake IndexedDB)
- `sync/syncClient.test.ts` — sync logic (fetch mocked with `vi.fn()`)
- `components/*.test.tsx` — ShopDot, TagBadge, SortToggle, SyncStatusBar, ItemCard

### E2E (Playwright — blackbox integration tests)

**Prerequisites:** Docker must be running. The suite spins up the full app container automatically.

```bash
# Install Playwright and its browsers (first time only)
npm --prefix e2e install
npx --prefix e2e playwright install chromium

# Run the full suite (API + UI chrome + UI mobile emulation)
npx playwright test --config e2e/playwright.config.ts

# API tests only (fast, no browser rendering)
npx playwright test --config e2e/playwright.config.ts --project=api

# Desktop Chrome UI tests only
npx playwright test --config e2e/playwright.config.ts --project=chrome

# Mobile emulation (Pixel 7 viewport + touch events, still headless)
npx playwright test --config e2e/playwright.config.ts --project=mobile

# Headed mode — opens a real browser window for debugging
npx playwright test --config e2e/playwright.config.ts --project=chrome --headed

# Open the HTML report after a run
npx playwright show-report e2e/playwright-report
```

The suite manages the Docker container lifecycle automatically:

- **Setup** — builds the image, starts the container with an isolated DB at `/tmp/grocery-e2e`, and polls `/api/bootstrap` until ready (up to 60 s).
- **Teardown** — runs `docker compose down --volumes` and removes the temp DB directory.

**Test layout:**

| File | What it covers |
|------|---------------|
| `e2e/api/bootstrap.spec.ts` | `GET /api/bootstrap` — structure, seeded data, serverTime, Content-Type |
| `e2e/api/sync.spec.ts` | `POST /api/sync` — create/update, conflicts, soft-delete, future lastSyncedAt, 400 errors |
| `e2e/ui/shops.spec.ts` | Settings › Shops — create, edit, delete |
| `e2e/ui/items.spec.ts` | Item catalog — create, tag, shop assignment, unit, history, search |
| `e2e/ui/lists.spec.ts` | Lists — create, add via search/suggestions, remove item, delete list |
| `e2e/ui/shopping.spec.ts` | Shopping mode — enter, buy, skip (swipe), undo, exit, persistence |
| `e2e/ui/conflicts.spec.ts` | Sync conflict badge, conflicts screen, resolve keep-server / keep-mine |
| `e2e/ui/offline.spec.ts` | Offline item creation, sync on reconnect, cached data browsable offline |

---

## Building for production

```bash
# 1. Build the React app
cd frontend && npm run build
# Outputs to frontend/dist/

# 2. Copy dist into the backend embed path
cp -r frontend/dist/* backend/frontend/dist/

# 3. Build the Go binary (embeds frontend/dist)
cd backend && go build -o grocery .

# 4. Run
./grocery --db ./grocery.db --port 8080
```

The resulting binary is fully self-contained — it serves both the API and the frontend with no external dependencies at
runtime.

---

## Deployment (Docker — home server)

### First deployment

```bash
# On the server: create the data directory
mkdir -p /srv/grocery

# Build and start
docker compose up -d --build
```

The SQLite database is stored at `/srv/grocery/grocery.db` on the host (bind-mounted into the container at
`/data/grocery.db`). It survives container restarts and image rebuilds.

### Update after code changes

```bash
docker compose build
docker compose up -d
```

### Backup

```bash
# Manual one-shot backup
cp /srv/grocery/grocery.db /srv/grocery/grocery-$(date +%F).db

# Recommended: add to crontab (daily at 02:00)
# 0 2 * * * cp /srv/grocery/grocery.db /srv/grocery/backups/grocery-$(date +\%F).db
```

SQLite WAL mode ensures consistent copies without locking the app.

### Logs

```bash
docker compose logs -f grocery
```

---

## API reference

| Method | Path             | Description                                                            |
|--------|------------------|------------------------------------------------------------------------|
| `GET`  | `/api/bootstrap` | Full data dump — all tables, used on first load                        |
| `POST` | `/api/sync`      | Bidirectional delta sync — send client changes, receive server changes |
| `GET`  | `/*`             | Serves React SPA; unknown paths fall back to `index.html`              |

### Sync request body

```json
{
  "lastSyncedAt": "2026-04-07T10:00:00Z",
  "changes": {
    "shops": [],
    "items": [],
    "tags": [],
    "itemShops": [],
    "itemTags": [],
    "lists": [],
    "listItems": [],
    "listItemSkippedShops": [],
    "shoppingSessions": [],
    "sessionItems": []
  }
}
```

### Sync response

```json
{
  "serverTime": "2026-04-07T10:05:00Z",
  "applied": [
    "id1",
    "id2"
  ],
  "conflicts": [],
  "serverChanges": {
    ...
  }
}
```

Conflicts occur when the same entity was modified on both client and server since `lastSyncedAt`. The app surfaces a
non-blocking notification and lets you resolve them in the Conflicts screen.

---

## Key design decisions

- **Offline-first** — all reads/writes go to IndexedDB (Dexie) first; the server is never on the critical path for UI
  interactions.
- **No auth** — single anonymous user; the app is intended to run on a private home server.
- **Client-generated UUIDs** — items and lists get their IDs in the browser before ever reaching the server, enabling
  offline creation without conflicts.
- **SQLite WAL mode** — single writer, fast reads, consistent backups.
- **No PWA** — the app requires an initial online load but works fully offline afterwards; installability was
  intentionally deferred.
