import { test, expect } from '../fixtures/groceries'

test.describe('Lists', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – create a list: list card visible on lists screen', async ({
    gotoApp, page,
  }) => {
    await gotoApp('/')

    await page.getByRole('button', { name: '+ New list' }).click()
    await page.getByPlaceholder('List name…').fill('My Shopping List')
    await page.getByRole('button', { name: 'Add' }).click()

    await expect(page.getByText('My Shopping List')).toBeVisible()
  })

  test('2 – add item to list via search: item card appears in browse mode', async ({
    seedViaApi, gotoList, page,
  }) => {
    const listId  = globalThis.crypto.randomUUID()
    const itemId  = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      items: [{ id: itemId, name: 'Tomatoes', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
      lists: [{ id: listId, name: 'Veggie List', version: 1, createdAt: t, updatedAt: t }],
    })

    await gotoList(listId)

    // Search for the item and select it from autocomplete
    await page.getByPlaceholder('Search items…').fill('Tomat')
    await page.getByText('Tomatoes').click()

    // Item card should appear in the list
    await expect(page.locator('[aria-label="Mark bought"], [aria-label="Mark active"]').first()).toBeVisible()
    await expect(page.getByText('Tomatoes').first()).toBeVisible()
  })

  test('3 – add item via suggestions panel: item added to list', async ({
    seedViaApi, gotoList, page,
  }) => {
    const listId    = globalThis.crypto.randomUUID()
    const itemId    = globalThis.crypto.randomUUID()
    const sessionId = globalThis.crypto.randomUUID()
    const shopId    = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()

    // Item needs purchase history to appear in suggestions (frequency > 0)
    await seedViaApi({
      shops: [{ id: shopId, name: 'Anywhere', color: '#3b82f6', version: 1, updatedAt: t }],
      items: [{ id: itemId, name: 'Eggs', unit: 'pcs', version: 1, createdAt: t, updatedAt: t }],
      lists: [{ id: listId, name: 'Quick List', version: 1, createdAt: t, updatedAt: t }],
      shoppingSessions: [{ id: sessionId, listId, shopId, startedAt: t, version: 1 }],
      sessionItems: [{
        id: globalThis.crypto.randomUUID(), sessionId, itemId, action: 'bought', at: t,
      }],
    })

    await gotoList(listId)

    // Suggestions panel shows frequent items — click the Eggs suggestion chip
    const suggestionChip = page.locator('button').filter({ hasText: 'Eggs' })
    await expect(suggestionChip.first()).toBeVisible()
    await suggestionChip.first().click()

    // Item should now appear in the list
    await expect(page.getByText('Eggs').first()).toBeVisible()
  })

  test('4 – remove item from list: item no longer in list', async ({
    seedViaApi, gotoList, page,
  }) => {
    const listId     = globalThis.crypto.randomUUID()
    const itemId     = globalThis.crypto.randomUUID()
    const listItemId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      items: [{ id: itemId, name: 'Potatoes', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
      lists: [{ id: listId, name: 'Meal Plan', version: 1, createdAt: t, updatedAt: t }],
      listItems: [{ id: listItemId, listId, itemId, state: 'active', version: 1, addedAt: t, updatedAt: t }],
    })

    await gotoList(listId)
    await expect(page.getByText('Potatoes')).toBeVisible()

    await page.getByRole('button', { name: 'Remove from list' }).click()

    await expect(page.getByText('Potatoes')).not.toBeVisible()
  })

  test('5 – delete a list: list card removed from lists screen', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const listId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      lists: [{ id: listId, name: 'List To Delete', version: 1, createdAt: t, updatedAt: t }],
    })

    await gotoApp('/')
    await expect(page.getByText('List To Delete')).toBeVisible()

    const listCard = page.locator('div').filter({ hasText: 'List To Delete' }).first()
    await listCard.getByRole('button', { name: 'Delete list' }).click()

    await expect(page.getByText('List To Delete')).not.toBeVisible()
  })
})
