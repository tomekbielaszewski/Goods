import { test, expect } from '@playwright/test'
import { resetViaApi, seedViaApi } from '../fixtures/grocery'

const ALL_ARRAY_KEYS = [
  'shops', 'items', 'tags', 'itemShops', 'itemTags',
  'lists', 'listItems', 'listItemSkippedShops',
  'shoppingSessions', 'sessionItems',
]

// Run serially so each scenario builds on a controlled state
test.describe.serial('GET /api/bootstrap', () => {
  test.beforeAll(async () => {
    await resetViaApi()
  })

  test('1 – empty database: HTTP 200, all 10 array keys present and empty', async ({ request }) => {
    const res = await request.get('/api/bootstrap')

    expect(res.status()).toBe(200)
    const body = await res.json() as Record<string, unknown>

    for (const key of ALL_ARRAY_KEYS) {
      expect(Array.isArray(body[key]), `${key} should be an array`).toBe(true)
      expect((body[key] as unknown[]).length, `${key} should be empty`).toBe(0)
    }
  })

  test('2 – after seeding one shop: shops array has length 1 with expected fields', async ({ request }) => {
    const shopId = globalThis.crypto.randomUUID()
    await seedViaApi({
      shops: [{
        id: shopId,
        name: 'Test Market',
        color: '#3b82f6',
        version: 1,
        updatedAt: new Date().toISOString(),
      }],
    })

    const res = await request.get('/api/bootstrap')
    const body = await res.json() as Record<string, unknown[]>

    const shops = body['shops'] as Array<Record<string, unknown>>
    expect(shops.length).toBe(1)

    const shop = shops[0]!
    expect(shop['id']).toBe(shopId)
    expect(shop['name']).toBe('Test Market')
    expect(shop['color']).toBe('#3b82f6')
    expect(typeof shop['version']).toBe('number')
    expect(typeof shop['updatedAt']).toBe('string')
  })

  test('3 – serverTime: valid ISO-8601 date close to Date.now()', async ({ request }) => {
    const before = Date.now()
    const res = await request.get('/api/bootstrap')
    const after = Date.now()

    const body = await res.json() as { serverTime: string }
    const serverMs = new Date(body.serverTime).getTime()

    expect(isNaN(serverMs)).toBe(false)
    // Allow ±5 s of clock skew between test runner and server
    expect(serverMs).toBeGreaterThanOrEqual(before - 5_000)
    expect(serverMs).toBeLessThanOrEqual(after + 5_000)
  })

  test('4 – Content-Type header is application/json', async ({ request }) => {
    const res = await request.get('/api/bootstrap')
    expect(res.headers()['content-type']).toContain('application/json')
  })
})
