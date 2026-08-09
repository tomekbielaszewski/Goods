import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { apiClient } from './client'
import type { AppEvent } from '../types/event'
import type { ServerEvent } from './transport'
import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
} from '../types'

// Pinned transport behavior exercised here:
// - loadData() = pull (GET /api/events?since=<lastSeq>) + sync() (POST outbox).
//   It does NOT open the SSE stream and it never touches fetch on its own
//   beyond those two calls.
// - sync() always POSTs (even an empty batch), clears the outbox on success,
//   and keeps the outbox untouched on failure.
// - connectStream(): () => void wires subscribeEventStream(lastSeq, handler);
//   stream events are applied, notify listeners, and advance lastSeq.
// - Mutations auto-publish: commit() itself triggers a sync, so events reach
//   the backend without waiting for loadData() to call sync().

// ── Helpers ────────────────────────────────────────────────────────────────────

type Route = {
  method?: 'GET' | 'POST'
  url: string
  response: Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function remoteEvent(
  type: string,
  entityId: string,
  payload: Record<string, unknown>,
  seq: number,
  lamport: number,
): ServerEvent {
  return {
    id: `evt-${seq}`,
    clientId: 'remote-client',
    lamport,
    timestamp: '2026-08-09T10:00:00.000Z',
    entityId,
    type,
    payload,
    seq,
  } as ServerEvent
}

function sseResponse(): { response: Response; feed: (ev: ServerEvent) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
  }
}

function mockFetch(routes: Route[]): Mock {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const route = routes.find(r => u.includes(r.url) && (!r.method || r.method === method))
    if (!route) throw new Error(`Unexpected fetch: ${method} ${u}`)
    return route.response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function postBodies(fetchMock: Mock): Array<{ events: ServerEvent[] }> {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(init!.body as string))
}

function getUrls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

// ── Offline-first snapshot contract ─────────────────────────────────────────────
// The client persists its state to localStorage as a single JSON blob under
// SNAPSHOT_KEY so a page refresh restores everything without re-downloading the
// whole event log. Documented shape (used by seedSnapshot below AND written by
// the implementation on every mutation/sync):
// {
//   shops, items, tags, lists, listItems, itemShops, itemTags,
//   listItemSkippedShops, shoppingSessions, sessionItems,  // entity data
//   outbox: AppEvent[],                                    // unpublished events
//   lastSeq, lamport, clientId, lastTs                     // stream position etc.
// }

const SNAPSHOT_KEY = 'grocery-snapshot'

type Snapshot = {
  shops: Shop[]
  items: Item[]
  tags: Tag[]
  lists: List[]
  listItems: ListItem[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
  outbox: AppEvent[]
  lastSeq: number
  lamport: number
  clientId: string
  lastTs: number
}

function seedSnapshot(partial: Partial<Snapshot> = {}): Snapshot {
  const snap: Snapshot = {
    shops: [],
    items: [],
    tags: [],
    lists: [],
    listItems: [],
    itemShops: [],
    itemTags: [],
    listItemSkippedShops: [],
    shoppingSessions: [],
    sessionItems: [],
    outbox: [],
    lastSeq: 0,
    lamport: 0,
    clientId: 'snapshot-client',
    lastTs: 0,
    ...partial,
  }
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  return snap
}

beforeEach(() => {
  apiClient.reset()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── loadData ───────────────────────────────────────────────────────────────────

describe('loadData', () => {
  it('pulls the full log, applies remote events, and advances lastSeq', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'GET', url: '/api/events?since=2', response: jsonResponse({ events: [], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()

    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.name).toBe('Remote Shop')
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Remote List')

    // Remote events must not land in the outbox: loadData's sync POST is empty.
    for (const body of postBodies(fetchMock)) {
      expect(body.events).toEqual([])
    }

    // lastSeq advanced to 2: the next loadData pulls since=2.
    await apiClient.loadData()
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=2'))).toHaveLength(1)
  })

  it('is idempotent: replaying the same events does not duplicate entities', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'GET', url: '/api/events?since=2', response: jsonResponse({ events: [], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()
    await apiClient.loadData()

    expect(await apiClient.getShops()).toHaveLength(1)
    expect(await apiClient.getLists()).toHaveLength(1)
  })

  it('notifies subscribe() listeners for each remote event', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    await apiClient.loadData()

    expect(received.map(e => e.type)).toEqual(['ShopCreated', 'ListCreated'])
    expect(received[0]!.entityId).toBe('shop-r1')
    expect(received[1]!.entityId).toBe('list-r1')
  })

  it('merges remote lamport: a later local mutation stamps a higher lamport', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 50)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt], lastSeq: 1 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    await apiClient.loadData()
    expect(received[0]!.lamport).toBe(50)

    await apiClient.createShop({ name: 'Local', color: '#000000' })
    expect(received[1]!.lamport).toBeGreaterThanOrEqual(51)
  })

  it('reset() clears lastSeq so the next loadData pulls since=0 again', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()
    apiClient.reset()
    await apiClient.loadData()

    const since2 = getUrls(fetchMock).filter(u => u.includes('?since=2'))
    expect(since2).toHaveLength(0)
    expect(getUrls(fetchMock).filter(u => u.includes('?since=0'))).toHaveLength(2)
  })
})

// ── sync ───────────────────────────────────────────────────────────────────────

describe('sync', () => {
  it('drains the outbox: POSTs stamped events, then an empty batch on the next sync', async () => {
    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    const [ev] = bodies[0]!.events
    expect(ev).toMatchObject({
      type: 'ShopCreated',
      entityId: shop.id,
      payload: { name: 'S', color: '#000000' },
    })
    expect(typeof ev.id).toBe('string')
    expect(ev.id.length).toBeGreaterThan(0)
    expect(typeof ev.clientId).toBe('string')
    expect(Number.isInteger(ev.lamport)).toBe(true)
    expect(ev.lamport).toBeGreaterThan(0)
    expect(typeof ev.timestamp).toBe('string')

    await apiClient.sync()
    const bodies2 = postBodies(fetchMock)
    expect(bodies2).toHaveLength(2)
    expect(bodies2[1]!.events).toEqual([])
  })

  it('keeps events in the outbox on failure; the next sync retries the same event', async () => {
    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    let attempts = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        attempts++
        if (attempts === 1) throw new Error('network down')
        return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 9 })
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.sync()).rejects.toThrow('network down')
    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    const firstId = bodies[0]!.events[0]!.id
    const secondId = bodies[1]!.events[0]!.id
    expect(secondId).toBe(firstId)
    expect(secondId).not.toBe(shop.id)
  })
})

// ── auto-sync after mutation ──────────────────────────────────────────────────

describe('auto-sync after mutation', () => {
  it('publishes the outbox automatically after a single mutation (no manual sync)', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    const [ev] = bodies[0]!.events
    expect(ev).toMatchObject({ type: 'ShopCreated', payload: { name: 'S', color: '#000000' } })
  })

  it('batches events committed before the sync completes into a single POST', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 2, duplicates: 0, lastSeq: 7 }) },
    ])

    await Promise.all([
      apiClient.createShop({ name: 'S', color: '#000000' }),
      apiClient.createList('Groceries'),
    ])
    await tick()
    await tick()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.events.map(e => e.type)).toEqual(['ShopCreated', 'ListCreated'])
  })

  it('persists across a page reload: the auto-published event is replayed by loadData', async () => {
    const server: ServerEvent[] = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && u.includes('/api/events')) {
        const body = JSON.parse(init!.body as string) as { events: AppEvent[] }
        for (const e of body.events) server.push({ ...e, seq: server.length + 1 })
        return jsonResponse({ accepted: body.events.length, duplicates: 0, lastSeq: server.length })
      }
      if (method === 'GET' && u.includes('/api/events?since=')) {
        const since = Number(u.split('since=')[1])
        return jsonResponse({ events: server.filter(e => e.seq > since), lastSeq: server.length })
      }
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()

    apiClient.reset() // simulate a page refresh: local state is gone
    await apiClient.loadData()

    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.id).toBe(shop.id)
    expect(shops[0]!.name).toBe('S')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('leaves the outbox empty after auto-publish: a later sync POSTs no events', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()
    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]!.events).toHaveLength(1)
    expect(bodies[1]!.events).toEqual([])
  })

  it('keeps the outbox when the automatic publish fails; a later sync retries the same event id', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        attempts++
        if (attempts === 1) throw new Error('network down')
        return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 9 })
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    expect(fetchMock.mock.calls.length).toBe(1)

    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    const firstId = bodies[0]!.events[0]!.id
    const secondId = bodies[1]!.events[0]!.id
    expect(secondId).toBe(firstId)
    expect(secondId).not.toBe(shop.id)
  })
})

// ── connectStream ──────────────────────────────────────────────────────────────

describe('connectStream', () => {
  it('wires the SSE stream, applies remote events, and notifies listeners', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/events/stream?since=0')

    feed(remoteEvent('ListCreated', 'list-live', { name: 'Live List' }, 7, 12))
    await tick()

    expect(received).toHaveLength(1)
    expect(received[0]!).toMatchObject({ type: 'ListCreated', entityId: 'list-live', lamport: 12 })
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Live List')
    unsubscribe()
  })

  it('stream events advance lastSeq and merge lamport', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
      { method: 'GET', url: '/api/events?since=7', response: jsonResponse({ events: [], lastSeq: 7 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 7 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    feed(remoteEvent('ShopCreated', 'shop-live', { name: 'Live', color: '#123456' }, 7, 50))
    await tick()
    expect(received[0]!.lamport).toBe(50)
    expect(await apiClient.getShops()).toHaveLength(1)

    // lastSeq advanced to 7: the next pull skips everything before seq 7.
    await apiClient.loadData()
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=7'))).toHaveLength(1)

    // Merged lamport: the next local mutation stamps > 50.
    await apiClient.createShop({ name: 'Local', color: '#000000' })
    expect(received.at(-1)!.lamport).toBeGreaterThan(50)
    unsubscribe()
  })
})

// ── offline-first localStorage persistence ─────────────────────────────────────

describe('localStorage persistence (offline-first)', () => {
  it('persists entities, lastSeq, and an empty outbox after a mutation auto-syncs', async () => {
    mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    const shop = await apiClient.createShop({ name: 'S', color: '#00ff00' })
    await tick()
    await tick()

    const raw = localStorage.getItem(SNAPSHOT_KEY)
    expect(raw).not.toBeNull()
    const snap = JSON.parse(raw!) as Snapshot
    expect(snap.shops).toEqual([
      expect.objectContaining({ id: shop.id, name: 'S', color: '#00ff00', version: 1 }),
    ])
    expect(snap.lastSeq).toBe(5)
    expect(snap.outbox).toEqual([])
    expect(typeof snap.clientId).toBe('string')
    expect(snap.clientId.length).toBeGreaterThan(0)
    expect(snap.lamport).toBeGreaterThanOrEqual(1)
    expect(typeof snap.lastTs).toBe('number')
  })

  it('restores the snapshot and pulls only events after the persisted lastSeq', async () => {
    const outboxEvt: AppEvent = {
      id: 'evt-outbox-1',
      clientId: 'snapshot-client',
      lamport: 4,
      timestamp: '2026-08-09T11:00:00.000Z',
      entityId: 'shop-pending',
      type: 'ShopCreated',
      payload: { name: 'Pending Shop', color: '#123456' },
    }
    seedSnapshot({
      shops: [
        { id: 'shop-restored', name: 'Restored Shop', color: '#ff0000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' },
        { id: 'shop-pending', name: 'Pending Shop', color: '#123456', version: 1, updatedAt: '2026-08-09T11:00:00.000Z' },
      ],
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      outbox: [outboxEvt],
      lastSeq: 24,
      lamport: 4,
    })
    const fetchMock = mockFetch([
      {
        method: 'GET',
        url: '/api/events?since=24',
        response: jsonResponse({
          events: [remoteEvent('ListCreated', 'list-new', { name: 'New List' }, 25, 10)],
          lastSeq: 25,
        }),
      },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 25 }) },
    ])

    await apiClient.loadData()

    // (1) incremental pull from the persisted position — never a full replay
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=0'))).toHaveLength(0)
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=24'))).toHaveLength(1)

    // (2) the restored entities are readable
    const shops = await apiClient.getShops()
    expect(shops.map(s => s.name)).toEqual(expect.arrayContaining(['Restored Shop', 'Pending Shop']))
    const lists = await apiClient.getLists()
    expect(lists.map(l => l.name)).toEqual(expect.arrayContaining(['Restored List']))

    // (3) the new event from the incremental pull is applied
    expect(lists.map(l => l.name)).toContain('New List')

    // (4) the restored outbox is POSTed with its ORIGINAL id (server dedupes)
    const sent = postBodies(fetchMock).flatMap(b => b.events)
    expect(sent).toHaveLength(1)
    expect(sent[0]!).toEqual(outboxEvt)

    // the snapshot advanced past the pull
    const after = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!) as Snapshot
    expect(after.lastSeq).toBe(25)
    expect(after.outbox).toEqual([])
  })

  it('boots offline: restores state without throwing and keeps the outbox for a later retry', async () => {
    const outboxEvt: AppEvent = {
      id: 'evt-outbox-1',
      clientId: 'snapshot-client',
      lamport: 4,
      timestamp: '2026-08-09T11:00:00.000Z',
      entityId: 'shop-pending',
      type: 'ShopCreated',
      payload: { name: 'Pending Shop', color: '#123456' },
    }
    seedSnapshot({
      shops: [
        { id: 'shop-restored', name: 'Restored Shop', color: '#ff0000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' },
        { id: 'shop-pending', name: 'Pending Shop', color: '#123456', version: 1, updatedAt: '2026-08-09T11:00:00.000Z' },
      ],
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      outbox: [outboxEvt],
      lastSeq: 24,
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    // the pull (and the POST attempt) fail, but the boot must not throw
    await expect(apiClient.loadData()).resolves.toBeUndefined()

    // the restored entities are still readable
    expect(await apiClient.getShops()).toHaveLength(2)
    expect(await apiClient.getLists()).toHaveLength(1)

    // the outbox survived the failed boot: a later sync() POSTs it with the same id
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 25 }) },
    ])
    await apiClient.sync()

    const sent = postBodies(fetchMock).flatMap(b => b.events)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.id).toBe('evt-outbox-1')
    expect(sent[0]!.clientId).toBe('snapshot-client')
    expect(sent[0]!.type).toBe('ShopCreated')

    const after = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!) as Snapshot
    expect(after.lastSeq).toBe(25)
    expect(after.outbox).toEqual([])
  })

  it('opens the stream at the persisted lastSeq after a restore boot', async () => {
    seedSnapshot({
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      lastSeq: 24,
    })
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=24', response: jsonResponse({ events: [], lastSeq: 24 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 24 }) },
      { method: 'GET', url: '/api/events/stream?since=24', response },
    ])

    await apiClient.loadData()
    const unsubscribe = apiClient.connectStream()

    const urls = getUrls(fetchMock)
    expect(urls.at(-1)!).toContain('/api/events/stream?since=24')
    expect(urls.filter(u => u.includes('/api/events/stream?since=0'))).toHaveLength(0)

    // the stream is live from the restored position
    feed(remoteEvent('ShopCreated', 'shop-live', { name: 'Live', color: '#abcdef' }, 26, 11))
    await tick()
    expect(await apiClient.getShops()).toHaveLength(1)
    unsubscribe()
  })

  it('reset() clears the persisted snapshot from localStorage', async () => {
    seedSnapshot({
      shops: [{ id: 'shop-r', name: 'R', color: '#000000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' }],
      lastSeq: 9,
    })
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull()

    apiClient.reset()

    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
  })
})
