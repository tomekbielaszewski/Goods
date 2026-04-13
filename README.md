# Groceries

Offline-first grocery management app. Works fully in the browser after the first load — no internet required while
shopping. Syncs in the background when connectivity is available.

---

## Development

### 0. Development requirements

| Tool             | Version    | Notes               |
|------------------|------------|---------------------|
| Go               | ≥ 1.25     | `go version`        |
| Node.js          | ≥ 22       | `node --version`    |
| Docker + Compose | any recent | for deployment only |

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

The database file is created automatically on first run.

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
```

Tests use a real in-memory SQLite database (`:memory:`) — no mocks for the data layer. Each test gets a fresh DB
instance.

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

- **Setup** — builds the image, starts the container with an isolated DB at `/tmp/grocery-e2e`, and polls
  `/api/bootstrap` until ready (up to 60 s).
- **Teardown** — runs `docker compose down --volumes` and removes the temp DB directory.

**Test layout:**

| File                        | What it covers                                                                            |
|-----------------------------|-------------------------------------------------------------------------------------------|
| `e2e/api/bootstrap.spec.ts` | `GET /api/bootstrap` — structure, seeded data, serverTime, Content-Type                   |
| `e2e/api/sync.spec.ts`      | `POST /api/sync` — create/update, conflicts, soft-delete, future lastSyncedAt, 400 errors |
| `e2e/ui/shops.spec.ts`      | Settings › Shops — create, edit, delete                                                   |
| `e2e/ui/items.spec.ts`      | Item catalog — create, tag, shop assignment, unit, history, search                        |
| `e2e/ui/lists.spec.ts`      | Lists — create, add via search/suggestions, remove item, delete list                      |
| `e2e/ui/shopping.spec.ts`   | Shopping mode — enter, buy, skip (swipe), undo, exit, persistence                         |
| `e2e/ui/conflicts.spec.ts`  | Sync conflict badge, conflicts screen, resolve keep-server / keep-mine                    |
| `e2e/ui/offline.spec.ts`    | Offline item creation, sync on reconnect, cached data browsable offline                   |

---

## API reference

See [docs/api.md](docs/api.md).
