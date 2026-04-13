import { test, expect } from '../fixtures/groceries'

test.describe('Repository › Items', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – create an item via New item screen: card appears in repository', async ({
    gotoApp, page,
  }) => {
    await gotoApp('/repository')

    await page.getByRole('button', { name: '+ New item' }).click()
    await expect(page).toHaveURL(/\/item\/new/)

    await page.getByPlaceholder('e.g. Whole milk').fill('Test Butter')
    // Select a unit (required for new items)
    await page.getByRole('button', { name: 'kg' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()

    // After save, navigates back
    await page.waitForURL(/\/repository|\//)
    // Navigate to repository to confirm
    await gotoApp('/repository')
    await expect(page.getByText('Test Butter')).toBeVisible()
  })

  test('2 – add a tag to an item: TagBadge visible on card', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const itemId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      items: [{ id: itemId, name: 'Butter', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
    })

    await gotoApp('/repository')
    // Click item name to open detail
    await page.getByText('Butter').click()
    await expect(page).toHaveURL(new RegExp(`/item/${itemId}`))

    const tagInput = page.getByPlaceholder('Add tag…')
    await tagInput.fill('dairy')
    await page.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()

    // Back in repository — tag badge should appear
    await gotoApp('/repository')
    const card = page.locator('button').filter({ hasText: 'Butter' })
    await expect(card.getByText('dairy')).toBeVisible()
  })

  test('3 – assign shops to item: ShopDots appear on card', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const shopId = globalThis.crypto.randomUUID()
    const itemId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      shops: [{ id: shopId, name: 'Lidl', color: '#eab308', version: 1, updatedAt: t }],
      items: [{ id: itemId, name: 'Cheese', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
    })

    await gotoApp('/repository')
    await page.getByText('Cheese').click()
    await expect(page).toHaveURL(new RegExp(`/item/${itemId}`))

    // Toggle the Lidl shop
    await page.getByRole('button', { name: /Lidl/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()

    await gotoApp('/repository')
    // The ShopDot circle should have the shop color inline style
    const card = page.locator('button').filter({ hasText: 'Cheese' })
    const dot = card.locator('[style*="background-color"]').first()
    await expect(dot).toBeVisible()
  })

  test('4 – edit default unit: detail screen shows updated value', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const itemId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      items: [{ id: itemId, name: 'Sugar', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
    })

    await gotoApp(`/item/${itemId}`)

    // Select a different unit preset
    await page.getByRole('button', { name: 'g' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()

    // Re-open detail to verify
    await gotoApp(`/item/${itemId}`)
    // The "g" unit button should be selected (has blue border class)
    const gButton = page.getByRole('button', { name: 'g' })
    await expect(gButton).toHaveClass(/border-blue-500/)
  })

  test('5 – purchase history visible when session items exist', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const sessionId = globalThis.crypto.randomUUID()
    const shopId   = globalThis.crypto.randomUUID()
    const itemId   = globalThis.crypto.randomUUID()
    const siId     = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()

    await seedViaApi({
      shops:   [{ id: shopId, name: 'Aldi', color: '#14b8a6', version: 1, updatedAt: t }],
      items:   [{ id: itemId, name: 'Oats', unit: 'kg', version: 1, createdAt: t, updatedAt: t }],
      shoppingSessions: [{ id: sessionId, listId: globalThis.crypto.randomUUID(), shopId, startedAt: t, version: 1 }],
      sessionItems: [{ id: siId, sessionId, itemId, action: 'bought', quantity: 1, unit: 'kg', at: t }],
    })

    await gotoApp(`/item/${itemId}`)

    await expect(page.getByText('Purchase history')).toBeVisible()
    await expect(page.getByText('Times bought')).toBeVisible()
    // The history table should have at least one row
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByText('bought')).toBeVisible()
  })

  test('6 – search filters items by name', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const t = new Date().toISOString()
    const id1 = globalThis.crypto.randomUUID()
    const id2 = globalThis.crypto.randomUUID()
    await seedViaApi({
      items: [
        { id: id1, name: 'Apple', unit: 'pcs', version: 1, createdAt: t, updatedAt: t },
        { id: id2, name: 'Banana', unit: 'pcs', version: 1, createdAt: t, updatedAt: t },
      ],
    })

    await gotoApp('/repository')

    await page.getByPlaceholder('Search items…').fill('Appl')
    await expect(page.getByText('Apple')).toBeVisible()
    await expect(page.getByText('Banana')).not.toBeVisible()
  })
})
