import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const E2E_DB_DIR = '/tmp/groceries-e2e'
const BASE_URL = 'http://localhost:8080'

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/bootstrap`)
      if (res.ok) return
    } catch (e) {
      lastErr = e
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms. Last error: ${lastErr}`)
}

export default async function globalSetup() {
  if (!existsSync(E2E_DB_DIR)) {
    mkdirSync(E2E_DB_DIR, { recursive: true })
  }

  // Tear down any stale containers from a previous run
  try {
    execSync(
      'docker compose -f docker-compose.yml -f docker-compose.e2e.yml down --volumes --remove-orphans',
      { cwd: ROOT, stdio: 'pipe' },
    )
  } catch {
    // Not running — ignore
  }

  // Build image and start container with the e2e DB volume
  console.log('[global-setup] Starting Docker container…')
  execSync(
    'docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build',
    { cwd: ROOT, stdio: 'inherit' },
  )

  console.log('[global-setup] Waiting for server to be ready…')
  await waitForReady(BASE_URL)
  console.log('[global-setup] Server is ready.')
}
