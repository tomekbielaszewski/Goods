import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/schema'
import { useStore } from '../store/useStore'
import { bootstrap, sync } from './syncClient'
import type { BootstrapResponse, SyncResponse } from '../types'

// Mock fetch globally
const fetchMock = vi.fn()
global.fetch = fetchMock

// Reset store between tests
const resetStore = () =>
  useStore.setState({
    syncStatus: 'idle',
    conflicts: [],
    lastSyncedAt: null,
    shoppingModeShopId: null,
    sortModes: {},
  })

// Wipe DB between tests
beforeEach(async () => {
  localStorage.clear()
  resetStore()
  fetchMock.mockReset()

  await db.transaction('rw', [
    db.shops, db.items, db.tags, db.itemShops, db.itemTags,
    db.lists, db.listItems, db.listItemSkippedShops,
    db.shoppingSessions, db.sessionItems, db.pendingSyncIds,
  ], async () => {
    await Promise.all([
      db.shops.clear(), db.items.clear(), db.tags.clear(),
      db.itemShops.clear(), db.itemTags.clear(), db.lists.clear(),
      db.listItems.clear(), db.listItemSkippedShops.clear(),
      db.shoppingSessions.clear(), db.sessionItems.clear(),
      db.pendingSyncIds.clear(),
    ])
  })

  // Default navigator.onLine to true
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Helpers
const emptyChanges = () => ({
  shops: [], items: [], tags: [], itemShops: [], itemTags: [],
  lists: [], listItems: [], listItemSkippedShops: [],
  shoppingSessions: [], sessionItems: [],
})

const makeBootstrapResponse = (overrides?: Partial<BootstrapResponse>): BootstrapResponse => ({
  serverTime: '2024-06-01T12:00:00.000Z',
  ...emptyChanges(),
  ...overrides,
})

const makeSyncResponse = (overrides?: Partial<SyncResponse>): SyncResponse => ({
  serverTime: '2024-06-01T12:00:00.000Z',
  applied: [],
  conflicts: [],
  serverChanges: emptyChanges(),
  ...overrides,
})

const mockJsonResponse = (data: unknown, ok = true) => {
  fetchMock.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  })
}

// ── bootstrap ─────────────────────────────────────────────────────────────────

describe('bootstrap', () => {
  it('bootstrap_callsCorrectEndpoint calls /api/bootstrap', async () => {
    mockJsonResponse(makeBootstrapResponse())
    await bootstrap()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/bootstrap')
  })

  it('bootstrap_writesDataToDexie writes shops and items to db', async () => {
    const response = makeBootstrapResponse({
      shops: [{ id: 'shop-1', name: 'Lidl', color: '#ff0', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' }],
      items: [{ id: 'item-1', name: 'Milk', version: 1, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
    })
    mockJsonResponse(response)

    await bootstrap()

    const shops = await db.shops.toArray()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.name).toBe('Lidl')

    const items = await db.items.toArray()
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Milk')
  })

  it('bootstrap_writesDataToDexie writes lists to db', async () => {
    const response = makeBootstrapResponse({
      lists: [{ id: 'list-1', name: 'Weekly', version: 1, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
    })
    mockJsonResponse(response)

    await bootstrap()

    const lists = await db.lists.toArray()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Weekly')
  })

  it('bootstrap_setsLastSyncedAt updates store with server time', async () => {
    const serverTime = '2024-06-01T12:00:00.000Z'
    mockJsonResponse(makeBootstrapResponse({ serverTime }))

    await bootstrap()

    expect(useStore.getState().lastSyncedAt).toBe(serverTime)
    expect(localStorage.getItem('lastSyncedAt')).toBe(serverTime)
  })

  it('bootstrap_setsLastSyncedAt sets status back to idle on success', async () => {
    mockJsonResponse(makeBootstrapResponse())
    await bootstrap()
    expect(useStore.getState().syncStatus).toBe('idle')
  })

  it('bootstrap_setsOfflineOnNetworkError sets status to error when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'))
    await bootstrap()
    expect(useStore.getState().syncStatus).toBe('error')
  })

  it('bootstrap_setsOfflineOnNetworkError sets status to error on non-ok response', async () => {
    mockJsonResponse({}, false)
    await bootstrap()
    expect(useStore.getState().syncStatus).toBe('error')
  })

  it('bootstrap sets status to syncing before fetch resolves', async () => {
    let capturedStatus = ''
    fetchMock.mockImplementationOnce(async () => {
      capturedStatus = useStore.getState().syncStatus
      return { ok: true, json: async () => makeBootstrapResponse() }
    })
    await bootstrap()
    expect(capturedStatus).toBe('syncing')
  })
})

// ── sync ──────────────────────────────────────────────────────────────────────

describe('sync', () => {
  it('sync_sendsChangesPayload sends POST to /api/sync', async () => {
    mockJsonResponse(makeSyncResponse())
    await sync()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sync')
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('sync_sendsChangesPayload body contains lastSyncedAt and changes shape', async () => {
    const lastSyncedAt = '2024-05-01T00:00:00.000Z'
    useStore.setState({ lastSyncedAt })
    mockJsonResponse(makeSyncResponse())

    await sync()

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.lastSyncedAt).toBe(lastSyncedAt)
    expect(body.changes).toBeDefined()
    expect(body.changes).toHaveProperty('shops')
    expect(body.changes).toHaveProperty('items')
    expect(body.changes).toHaveProperty('listItems')
  })

  it('sync_sendsChangesPayload uses epoch when lastSyncedAt is null', async () => {
    useStore.setState({ lastSyncedAt: null })
    mockJsonResponse(makeSyncResponse())

    await sync()

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.lastSyncedAt).toBe(new Date(0).toISOString())
  })

  it('sync_appliesServerChanges writes server items to db', async () => {
    mockJsonResponse(makeSyncResponse({
      serverChanges: {
        ...emptyChanges(),
        items: [{ id: 'srv-item-1', name: 'Server Butter', version: 2, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
      },
    }))

    await sync()

    const items = await db.items.toArray()
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Server Butter')
  })

  it('sync_appliesServerChanges clears applied ids from pendingSyncIds', async () => {
    // Seed some pending
    await db.pendingSyncIds.bulkPut([
      { id: 'item-1', entity: 'item', changedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'item-2', entity: 'item', changedAt: '2024-01-01T00:00:00.000Z' },
    ])

    mockJsonResponse(makeSyncResponse({ applied: ['item-1'] }))
    await sync()

    const remaining = await db.pendingSyncIds.toArray()
    expect(remaining.map(r => r.id)).not.toContain('item-1')
    expect(remaining.map(r => r.id)).toContain('item-2')
  })

  it('sync_queuesConflicts calls addConflicts with server conflicts', async () => {
    const addConflictsSpy = vi.spyOn(useStore.getState(), 'addConflicts')

    const conflicts = [
      { entity: 'item', id: 'item-1', client: { name: 'Old' }, server: { name: 'New' } },
    ]
    mockJsonResponse(makeSyncResponse({ conflicts }))

    await sync()

    // Check that conflicts ended up in store
    expect(useStore.getState().conflicts).toHaveLength(1)
    expect(useStore.getState().conflicts[0]!.id).toBe('item-1')
    addConflictsSpy.mockRestore()
  })

  it('sync_queuesConflicts does not add conflicts when response has none', async () => {
    mockJsonResponse(makeSyncResponse({ conflicts: [] }))
    await sync()
    expect(useStore.getState().conflicts).toHaveLength(0)
  })

  it('sync updates lastSyncedAt to server time', async () => {
    const serverTime = '2024-07-15T08:00:00.000Z'
    mockJsonResponse(makeSyncResponse({ serverTime }))

    await sync()

    expect(useStore.getState().lastSyncedAt).toBe(serverTime)
  })

  it('sync_setsOfflineWhenOffline sets status to offline when navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    await sync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useStore.getState().syncStatus).toBe('offline')
  })

  it('sync sets error status when fetch throws while online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    fetchMock.mockRejectedValueOnce(new Error('Network failure'))

    await sync()

    expect(useStore.getState().syncStatus).toBe('error')
  })

  it('sync sets error status on non-ok response', async () => {
    mockJsonResponse({}, false)
    await sync()
    expect(useStore.getState().syncStatus).toBe('error')
  })
})
