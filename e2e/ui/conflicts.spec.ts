import { test, expect } from '../fixtures/groceries'
import { seedViaApi as apiSeed } from '../fixtures/groceries'

/**
 * Creates a conflict scenario:
 * 1. Seed entity at time T0.
 * 2. Update entity on the server at T1 (T1 > T0).
 * 3. Update entity in the browser's IndexedDB at T2 (T2 > T0).
 * 4. Dispatch 'online' event so scheduleSync → sync() runs and receives conflict.
 */
async function setupConflict(page: import('@playwright/test').Page) {
  const shopId = globalThis.crypto.randomUUID()
  const t0 = new Date(Date.now() - 120_000).toISOString()
  const t1 = new Date(Date.now() - 60_000).toISOString()
  const t2 = new Date(Date.now() - 30_000).toISOString()

  // 1. Initial creation
  await apiSeed(
    { shops: [{ id: shopId, name: 'Original Name', color: '#3b82f6', version: 1, updatedAt: new Date(Date.now() - 150_000).toISOString() }] },
    new Date(Date.now() - 200_000).toISOString(),
  )

  // 2. Server-side update (T1)
  await apiSeed(
    { shops: [{ id: shopId, name: 'Server Name', color: '#3b82f6', version: 2, updatedAt: t1 }] },
    new Date(Date.now() - 150_000).toISOString(),
  )

  // Bootstrap the page so IndexedDB has the entity and lastSyncedAt is T0
  if (!page.url().startsWith('http://localhost:8080')) {
    await page.goto('http://localhost:8080/')
  }
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      const r = indexedDB.deleteDatabase('grocery')
      r.onsuccess = r.onerror = () => resolve()
      r.onblocked = () => resolve()
    })
  })
  await page.goto('http://localhost:8080/')
  await page.waitForLoadState('networkidle')

  // 3. Browser-side update via raw IndexedDB (T2) — also add to pendingSyncIds
  await page.evaluate(
    async ({ shopId, t0, t2 }) => {
      const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      const db = await open('grocery')

      const tx = db.transaction(['shops', 'pendingSyncIds'], 'readwrite')
      const shopStore = tx.objectStore('shops')
      const pendingStore = tx.objectStore('pendingSyncIds')

      await new Promise<void>((resolve, reject) => {
        const r = shopStore.put({ id: shopId, name: 'Client Name', color: '#ef4444', version: 2, updatedAt: t2 })
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
      })
      await new Promise<void>((resolve, reject) => {
        const r = pendingStore.put({ id: shopId, entity: 'shop', changedAt: t2 })
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
      })
      db.close()

      // Also force lastSyncedAt in localStorage to be T0
      // The app stores it in Zustand (memory) — we reset it indirectly by
      // dispatching 'online' which re-runs sync with the in-memory lastSyncedAt.
      // After bootstrap, lastSyncedAt should be set to server bootstrap time
      // which is before the server update at T1.
      void t0
    },
    { shopId, t0, t2 },
  )

  // 4. Trigger sync — this should return the conflict
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  // Wait for sync to complete (SyncStatusBar goes from "Syncing…" to showing conflict)
  await page.waitForTimeout(2_000)

  return shopId
}

test.describe('Conflict resolution', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – conflict badge visible in SyncStatusBar after sync', async ({
    page,
  }) => {
    await setupConflict(page)

    // SyncStatusBar should show the conflict indicator button
    await expect(page.getByText(/conflict/i)).toBeVisible()
  })

  test('2 – conflicts screen shows conflicted entities', async ({
    page,
  }) => {
    await setupConflict(page)

    // Navigate to conflicts screen via the badge button
    await page.getByText(/conflict/i).click()
    await expect(page).toHaveURL(/\/conflicts/)

    // At least one conflict card should be present
    await expect(page.getByText(/shop:/i)).toBeVisible()
    await expect(page.getByText(/field.*differ/i)).toBeVisible()
  })

  test('3 – resolve conflict: keep server value', async ({
    page,
  }) => {
    await setupConflict(page)

    await page.getByText(/conflict/i).click()
    await expect(page).toHaveURL(/\/conflicts/)

    await page.getByRole('button', { name: 'Use server' }).click()

    // Conflict cleared — either no more conflicts or navigated away
    await expect(page.getByRole('button', { name: 'Use server' })).not.toBeVisible()
  })

  test('4 – resolve conflict: keep client (mine) value', async ({
    page,
  }) => {
    await setupConflict(page)

    await page.getByText(/conflict/i).click()
    await expect(page).toHaveURL(/\/conflicts/)

    await page.getByRole('button', { name: 'Keep mine' }).click()

    await expect(page.getByRole('button', { name: 'Keep mine' })).not.toBeVisible()
  })
})
