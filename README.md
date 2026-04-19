# Groceries

Offline-first groceries management app. Works fully in the browser after the first load — no internet required while
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
go run . --db ./groceries.db --port 8080

# Or build and run the binary
go build -o groceries .
./groceries --db ./groceries.db --port 8080
```

Flags:

| Flag     | Default        | Description                  |
|----------|----------------|------------------------------|
| `--db`   | `./groceries.db` | Path to SQLite database file |
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
cd backend && go run . --db ./groceries.db

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

---

## API reference

See [docs/api.md](docs/api.md).
