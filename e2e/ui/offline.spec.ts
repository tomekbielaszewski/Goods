import { test, expect } from '../fixtures/grocery'

test.describe('Offline behaviour', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – create item while offline: item appears immediately in UI (Dexie write)', async ({
    gotoApp, page,
  }) => {
    // Load the app online first so bootstrap completes
    await gotoApp('/repository')
    await expect(page.getByRole('button', { name: '+ New item' })).toBeVisible()

    // Go offline
    await page.context().setOffline(true)
    await expect(page.getByText('Offline')).toBeVisible()

    // Navigate to new item screen and create an item
    await page.getByRole('button', { name: '+ New item' }).click()
    await page.getByPlaceholder('e.g. Whole milk').fill('Offline Item')
    await page.getByRole('button', { name: 'kg' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()

    // Item should appear in repository immediately (Dexie local write)
    await page.waitForURL(/\/repository|\//)
    if (!page.url().includes('/repository')) {
      await page.goto('http://localhost:8080/repository')
    }
    await expect(page.getByText('Offline Item')).toBeVisible()

    // Restore online to not pollute subsequent tests
    await page.context().setOffline(false)
  })

  test('2 – sync on reconnect: item syncs and no sync error badge', async ({
    gotoApp, page,
  }) => {
    await gotoApp('/repository')

    // Go offline, create an item
    await page.context().setOffline(true)
    await page.getByRole('button', { name: '+ New item' }).click()
    await page.getByPlaceholder('e.g. Whole milk').fill('Reconnect Item')
    await page.getByRole('button', { name: 'pcs' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()

    // Go back online — the 'online' event triggers sync()
    await page.context().setOffline(false)
    // Let sync complete
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_500)

    // No sync error should be displayed
    await expect(page.getByText('Sync error')).not.toBeVisible()
    await expect(page.getByText('Offline')).not.toBeVisible()
  })

  test('3 – browse list data while offline: data still accessible', async ({
    seedViaApi, gotoList, page,
  }) => {
    const listId     = globalThis.crypto.randomUUID()
    const itemId     = globalThis.crypto.randomUUID()
    const listItemId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()

    await seedViaApi({
      items: [{ id: itemId, name: 'Cached Item', unit: 'pcs', version: 1, createdAt: t, updatedAt: t }],
      lists: [{ id: listId, name: 'Cached List', version: 1, createdAt: t, updatedAt: t }],
      listItems: [{ id: listItemId, listId, itemId, state: 'active', version: 1, addedAt: t, updatedAt: t }],
    })

    // Load the list online (data bootstrapped into Dexie)
    await gotoList(listId)
    await expect(page.getByText('Cached Item')).toBeVisible()

    // Go offline
    await page.context().setOffline(true)

    // Navigate away and come back
    await page.goto('http://localhost:8080/')
    await page.getByText('Cached List').click()

    // Data should still be available from Dexie
    await expect(page.getByText('Cached Item')).toBeVisible()

    await page.context().setOffline(false)
  })
})
