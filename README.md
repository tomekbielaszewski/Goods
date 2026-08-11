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

Tests use `happy-dom` as the browser environment — no real browser or network required.

---

## Docker deployment

The [Dockerfile](Dockerfile) is a multi-stage build: it compiles the frontend with Node 22, cross-compiles the Go backend,
and copies the result into a minimal Alpine runtime image. The server listens on port `8080` and stores the SQLite
database at `/data/groceries.db`, so mount a volume at `/data` to keep data across container restarts.

### Build

```bash
docker build -t groceries .
```

### Docker run

```bash
docker run -d \
  --name groceries \
  -p 8080:8080 \
  -v groceries-data:/data \
  --restart unless-stopped \
  groceries
```

### Docker Compose

A [docker-compose.yml](docker-compose.yml) is included.  
It pulls the prebuilt image from GHCR, maps port `8080`, and stores the SQLite database in the local `./groceries`
directory.

---

## Published images and releases

CI publishes the app to GHCR (`ghcr.io/tomekbielaszewski/groceries`) and creates GitHub releases automatically:

| Trigger | Docker tag | GitHub release |
|---------|------------|----------------|
| Push to `master` | `dev` — latest development build | — |
| Tag `vX.Y.Z` (semver) on `master` | `latest` + `X.Y.Z` — stable build | Yes, with prebuilt binaries |

### Releases

Tagging a commit on `master` with a semver tag starting with `v` publishes the stable release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This builds the `latest` and `v1.0.0`-versioned images, and creates a GitHub release (with auto-generated release notes)
attached with prebuilt binaries for macOS and Linux (amd64 + arm64) — the frontend is compiled into the single
executable, no extra files needed:

```
groceries-darwin-amd64
groceries-darwin-arm64
groceries-linux-amd64
groceries-linux-arm64
```

Run a binary with the same flags as a local build, e.g. `./groceries-linux-amd64 --db ./groceries.db --port 8080`.
