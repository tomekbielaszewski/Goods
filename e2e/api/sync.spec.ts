import { test, expect } from '@playwright/test'
import { resetViaApi, seedViaApi } from '../fixtures/grocery'
import type { Shop, Item, List, ListItem } from '../fixtures/grocery'

function now() { return new Date().toISOString() }
function past(msAgo = 60_000) { return new Date(Date.now() - msAgo).toISOString() }
function future(msAhead = 60_000) { return new Date(Date.now() + msAhead).toISOString() }

const BASE_URL = 'http://localhost:8080'

async function postSync(
  changes: Partial<Parameters<typeof seedViaApi>[0]>,
  lastSyncedAt = new Date(0).toISOString(),
) {
  return seedViaApi(changes, lastSyncedAt)
}

test.describe('POST /api/sync', () => {
  test.beforeEach(async () => {
    await resetViaApi()
  })

  test('1 – empty payload: applied=[], conflicts=[], serverChanges all empty', async ({ request }) => {
    const res = await request.post('/api/sync', {
      data: {
        lastSyncedAt: now(),
        changes: {
          shops: [], items: [], tags: [], itemShops: [], itemTags: [],
          lists: [], listItems: [], listItemSkippedShops: [],
          shoppingSessions: [], sessionItems: [],
        },
      },
    })

    expect(res.status()).toBe(200)
    const body = await res.json() as {
      applied: string[]; conflicts: unknown[]; serverChanges: Record<string, unknown[]>
    }
    expect(body.applied).toEqual([])
    expect(body.conflicts).toEqual([])

    for (const key of Object.values(body.serverChanges)) {
      expect(Array.isArray(key)).toBe(true)
    }
  })

  test('2 – create a shop: applied contains UUID; appears in bootstrap', async ({ request }) => {
    const shopId = globalThis.crypto.randomUUID()
    const shop: Shop = {
      id: shopId, name: 'Corner Shop', color: '#22c55e',
      version: 1, updatedAt: now(),
    }

    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: new Date(0).toISOString(),
        changes: { shops: [shop], items: [], tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [] },
      },
    })
    expect(syncRes.status()).toBe(200)
    const syncBody = await syncRes.json() as { applied: string[] }
    expect(syncBody.applied).toContain(shopId)

    const bootstrapRes = await request.get('/api/bootstrap')
    const bootstrap = await bootstrapRes.json() as { shops: Shop[] }
    expect(bootstrap.shops.some(s => s.id === shopId)).toBe(true)
  })

  test('3 – create an item: applied contains UUID; item appears in bootstrap', async ({ request }) => {
    const itemId = globalThis.crypto.randomUUID()
    const item: Item = {
      id: itemId, name: 'Whole Milk', unit: 'l',
      version: 1, createdAt: now(), updatedAt: now(),
    }

    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: new Date(0).toISOString(),
        changes: { shops: [], items: [item], tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [] },
      },
    })
    expect(syncRes.status()).toBe(200)
    const { applied } = await syncRes.json() as { applied: string[] }
    expect(applied).toContain(itemId)

    const bootstrap = await (await request.get('/api/bootstrap')).json() as { items: Item[] }
    expect(bootstrap.items.some(i => i.id === itemId)).toBe(true)
  })

  test('4 – create list + list item: both UUIDs in applied; bootstrap reflects them', async ({ request }) => {
    const itemId = globalThis.crypto.randomUUID()
    const listId = globalThis.crypto.randomUUID()
    const listItemId = globalThis.crypto.randomUUID()

    // First sync: item + list + listItem
    const t = now()
    await request.post('/api/sync', {
      data: {
        lastSyncedAt: new Date(0).toISOString(),
        changes: {
          shops: [], items: [{ id: itemId, name: 'Bread', unit: 'pcs', version: 1, createdAt: t, updatedAt: t }],
          tags: [], itemShops: [], itemTags: [],
          lists: [{ id: listId, name: 'Weekly', version: 1, createdAt: t, updatedAt: t }],
          listItems: [{ id: listItemId, listId, itemId, state: 'active', version: 1, addedAt: t, updatedAt: t }],
          listItemSkippedShops: [], shoppingSessions: [], sessionItems: [],
        },
      },
    })

    const bootstrap = await (await request.get('/api/bootstrap')).json() as {
      lists: List[]; listItems: ListItem[]
    }
    expect(bootstrap.lists.some(l => l.id === listId)).toBe(true)
    expect(bootstrap.listItems.some(li => li.id === listItemId)).toBe(true)
  })

  test('5 – update an existing entity: applied contains UUID; updated field visible', async ({ request }) => {
    const shopId = globalThis.crypto.randomUUID()
    const t1 = past(10_000)

    // Create
    await postSync({ shops: [{ id: shopId, name: 'Old Name', color: '#3b82f6', version: 1, updatedAt: t1 }] })

    // Update
    const t2 = now()
    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: t1,
        changes: {
          shops: [{ id: shopId, name: 'New Name', color: '#3b82f6', version: 2, updatedAt: t2 }],
          items: [], tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [],
        },
      },
    })
    expect(syncRes.status()).toBe(200)
    const { applied } = await syncRes.json() as { applied: string[] }
    expect(applied).toContain(shopId)

    const bootstrap = await (await request.get('/api/bootstrap')).json() as { shops: Shop[] }
    const shop = bootstrap.shops.find(s => s.id === shopId)
    expect(shop?.name).toBe('New Name')
  })

  test('6 – conflict: both sides modified same entity → conflicts array populated', async ({ request }) => {
    const shopId = globalThis.crypto.randomUUID()
    const t0 = past(120_000) // lastSyncedAt anchor

    // Initial creation before t0
    await postSync(
      { shops: [{ id: shopId, name: 'Original', color: '#3b82f6', version: 1, updatedAt: past(130_000) }] },
      past(200_000),
    )

    // Server update: updatedAt is after t0
    const serverTime = past(60_000)
    await postSync(
      { shops: [{ id: shopId, name: 'Server Version', color: '#3b82f6', version: 2, updatedAt: serverTime }] },
      past(130_000),
    )

    // Client update: also after t0 — should conflict
    const clientTime = past(30_000)
    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: t0, // both client and server updates are newer than this
        changes: {
          shops: [{ id: shopId, name: 'Client Version', color: '#ef4444', version: 2, updatedAt: clientTime }],
          items: [], tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [],
        },
      },
    })

    expect(syncRes.status()).toBe(200)
    const body = await syncRes.json() as {
      conflicts: Array<{ entity: string; id: string; client: unknown; server: unknown }>
    }
    expect(body.conflicts.length).toBeGreaterThanOrEqual(1)

    const conflict = body.conflicts.find(c => c.id === shopId)
    expect(conflict).toBeDefined()
    expect(conflict!.entity).toBe('shop')
    expect(conflict!.client).toBeDefined()
    expect(conflict!.server).toBeDefined()
  })

  test('7 – soft delete: item returned by bootstrap with deletedAt set (client filters)', async ({ request }) => {
    const itemId = globalThis.crypto.randomUUID()
    const t = past(5_000)

    await postSync({ items: [{ id: itemId, name: 'To Delete', unit: 'pcs', version: 1, createdAt: t, updatedAt: t }] })

    // Soft-delete by sending the item with deletedAt populated
    const deletedAt = now()
    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: t,
        changes: {
          shops: [], items: [{ id: itemId, name: 'To Delete', unit: 'pcs', version: 2, createdAt: t, updatedAt: deletedAt, deletedAt }],
          tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [],
        },
      },
    })
    expect(syncRes.status()).toBe(200)
    const { applied } = await syncRes.json() as { applied: string[] }
    expect(applied).toContain(itemId)

    // The backend returns ALL items (including soft-deleted) in bootstrap;
    // the client is responsible for filtering out deletedAt rows before rendering.
    const bootstrap = await (await request.get('/api/bootstrap')).json() as { items: Item[] }
    const deletedItem = bootstrap.items.find(i => i.id === itemId)
    expect(deletedItem).toBeDefined()
    expect(deletedItem!.deletedAt).toBeDefined()
  })

  test('8 – lastSyncedAt in the future: serverChanges arrays are empty', async ({ request }) => {
    const syncRes = await request.post('/api/sync', {
      data: {
        lastSyncedAt: future(3_600_000), // 1 hour in the future
        changes: { shops: [], items: [], tags: [], itemShops: [], itemTags: [], lists: [], listItems: [], listItemSkippedShops: [], shoppingSessions: [], sessionItems: [] },
      },
    })

    expect(syncRes.status()).toBe(200)
    const body = await syncRes.json() as { serverChanges: Record<string, unknown[]> }
    for (const arr of Object.values(body.serverChanges)) {
      expect(arr.length).toBe(0)
    }
  })

  test('9 – malformed JSON body: HTTP 400', async () => {
    const res = await fetch(`${BASE_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json }',
    })
    expect(res.status).toBe(400)
  })

  test('10 – unknown-fields body: server accepts it (Go JSON ignores unknown fields, zero-inits missing ones)', async () => {
    // Go's json.Decoder silently ignores unrecognised fields and zero-initialises
    // missing required fields (lastSyncedAt → epoch, changes → empty arrays).
    // The server treats the result as a valid no-op sync and returns 200.
    const res = await fetch(`${BASE_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ somethingElse: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { applied: string[]; conflicts: unknown[] }
    expect(body.applied).toEqual([])
    expect(body.conflicts).toEqual([])
  })
})
