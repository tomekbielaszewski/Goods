import { execSync } from 'child_process'
import { rmSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const E2E_DB_DIR = '/tmp/groceries-e2e'

export default async function globalTeardown() {
  console.log('[global-teardown] Stopping Docker container…')
  try {
    execSync(
      'docker compose -f docker-compose.yml -f docker-compose.e2e.yml down --volumes',
      { cwd: ROOT, stdio: 'inherit' },
    )
  } catch (e) {
    console.error('[global-teardown] docker compose down failed:', e)
  }

  try {
    rmSync(E2E_DB_DIR, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }

  console.log('[global-teardown] Done.')
}
