import { test, expect } from '../fixtures/grocery'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seed() {
  const shopId     = globalThis.crypto.randomUUID()
  const itemId     = globalThis.crypto.randomUUID()
  const listId     = globalThis.crypto.randomUUID()
  const listItemId = globalThis.crypto.randomUUID()
  const t = new Date().toISOString()

  return {
    shopId, itemId, listId, listItemId,
    data: {
      shops: [{ id: shopId, name: 'SuperMart', color: '#22c55e', version: 1, updatedAt: t }],
      items: [{ id: itemId, name: 'Milk', unit: 'l', version: 1, createdAt: t, updatedAt: t }],
      lists: [{ id: listId, name: 'Weekly Run', version: 1, createdAt: t, updatedAt: t }],
      listItems: [{ id: listItemId, listId, itemId, state: 'active' as const, version: 1, addedAt: t, updatedAt: t }],
      // Associate item with the shop so it shows up in shopping mode
      itemShops: [{ itemId, shopId }],
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Shopping mode', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – enter shopping mode: shop selector and Done button appear', async ({
    seedViaApi, gotoList, page,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    // Browse mode: "Shop" button visible
    await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible()
    await page.getByRole('button', { name: 'Shop' }).click()

    // Shopping mode: shop dropdown + "Done" button replace "Shop"
    await expect(page.getByRole('combobox')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shop' })).not.toBeVisible()
  })

  test('2 – mark item as bought: moves to Bought section', async ({
    seedViaApi, gotoList, page,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    await page.getByRole('button', { name: 'Shop' }).click()

    // The item card (round indicator button) — click it to buy
    const itemCard = page.locator('button').filter({ hasText: 'Milk' }).first()
    await expect(itemCard).toBeVisible()
    await itemCard.click()

    // "Bought" section heading and the item in strikethrough
    await expect(page.getByText('Bought').first()).toBeVisible()
    const boughtItem = page.locator('button').filter({ hasText: 'Milk' })
    await expect(boughtItem).toHaveClass(/line-through/)
  })

  test('3 – skip shop for item (swipe left): item disappears from active list', async ({
    seedViaApi, gotoList, page, swipeCard,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    await page.getByRole('button', { name: 'Shop' }).click()

    const itemCard = page.locator('button').filter({ hasText: 'Milk' }).first()
    await expect(itemCard).toBeVisible()

    await swipeCard(itemCard, 'left')

    // After skipping, the item is no longer visible in the active shopping list
    // (it is filtered out because shoppingModeShopId is in skippedShopIds)
    await expect(itemCard).not.toBeVisible()
  })

  test('4 – undo bought: item returns to active state', async ({
    seedViaApi, gotoList, page,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    await page.getByRole('button', { name: 'Shop' }).click()

    // Buy the item
    const activeCard = page.locator('button').filter({ hasText: 'Milk' }).first()
    await activeCard.click()
    await expect(page.getByText('Bought').first()).toBeVisible()

    // Click the bought item to undo
    const boughtCard = page.locator('button').filter({ hasText: 'Milk' })
    await boughtCard.click()

    // Item should be back in active (no line-through styling visible)
    await expect(page.locator('button').filter({ hasText: 'Milk' })).not.toHaveClass(/line-through/)
  })

  test('5 – end shopping session: Done exits shopping mode', async ({
    seedViaApi, gotoList, page,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    await page.getByRole('button', { name: 'Shop' }).click()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()

    await page.getByRole('button', { name: 'Done' }).click()

    // Browse mode controls return
    await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Done' })).not.toBeVisible()
  })

  test('6 – bought state persists after page reload', async ({
    seedViaApi, gotoList, page,
  }) => {
    const { listId, data } = seed()
    await seedViaApi(data)
    await gotoList(listId)

    await page.getByRole('button', { name: 'Shop' }).click()
    const activeCard = page.locator('button').filter({ hasText: 'Milk' }).first()
    await activeCard.click()
    await page.getByRole('button', { name: 'Done' }).click()

    // Reload without clearing IndexedDB — Dexie persists the state
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Item should still be in "bought" state (state stored in IndexedDB)
    const boughtCard = page.locator('button').filter({ hasText: 'Milk' })
    await expect(boughtCard).toHaveClass(/line-through/)
  })
})
