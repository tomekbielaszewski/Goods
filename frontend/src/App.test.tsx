import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { apiClient } from './api/client'
import { useStore } from './store/useStore'
import type { List } from './types'

// Pinned startup behavior exercised here:
// - App mounts → useEffect (mount only) calls useStore.getState().loadData()
//   (which pulls GET /api/events?since=0 + POSTs the outbox via sync) and
//   apiClient.connectStream(), storing the returned unsubscribe fn.
// - App unmounts → the stored unsubscribe fn is invoked (stream cleanup).

// ── Helpers (mirrors client.transport.test.ts style) ──────────────────────────

type Route = {
  method?: 'GET' | 'POST'
  url: string
  response: Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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

const bootRoutes = (): Route[] => {
  const stream = sseRoute()
  return [
    { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [], lastSeq: 0 }) },
    { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 0 }) },
    stream.route,
  ]
}

// SSE stream route: a stream that stays open and never emits — keeps
// connectStream's fetch from throwing while staying inert.
function sseRoute(): { route: Route } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const route: Route = {
    method: 'GET',
    url: '/api/events/stream',
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
  }
  return { route }
}

const restoredRoutes = (): Route[] => {
  const stream = sseRoute()
  return [
    {
      method: 'GET',
      url: '/api/events?since=0',
      response: jsonResponse({
        events: [{
          id: 'evt-1',
          clientId: 'remote',
          lamport: 1,
          timestamp: '2026-08-09T10:00:00.000Z',
          entityId: 'list-1',
          type: 'ListCreated',
          payload: { name: 'Restored List' },
          seq: 1,
        }],
        lastSeq: 1,
      }),
    },
    { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
    stream.route,
  ]
}

// Offline-first snapshot: the client persists its state as a single JSON blob in
// localStorage under SNAPSHOT_KEY (see client.transport.test.ts for the full
// documented shape). seedSnapshot writes a previous session's snapshot so these
// tests can pin restore-on-boot behavior.
const SNAPSHOT_KEY = 'grocery-snapshot'

function seedSnapshot(partial: { lists?: List[]; lastSeq?: number } = {}): void {
  const snap = {
    shops: [],
    items: [],
    tags: [],
    lists: partial.lists ?? [],
    listItems: [],
    itemShops: [],
    itemTags: [],
    listItemSkippedShops: [],
    shoppingSessions: [],
    sessionItems: [],
    outbox: [],
    lastSeq: partial.lastSeq ?? 0,
    lamport: 0,
    clientId: 'snapshot-client',
    lastTs: 0,
  }
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
}

beforeEach(() => {
  apiClient.reset()
  localStorage.clear()
  useStore.setState({
    shoppingModeShopId: null,
    sortModes: {},
    shops: [],
    items: [],
    tags: [],
    lists: [],
    listItems: [],
    shoppingSessions: [],
    sessionItems: [],
    itemShops: [],
    itemTags: [],
    listItemSkippedShops: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  )

describe('App — startup wiring', () => {
  it('bootstraps data and connects the event stream on mount', async () => {
    const unsubscribe = vi.fn()
    const connectSpy = vi.spyOn(apiClient, 'connectStream').mockReturnValue(unsubscribe)
    const fetchMock = mockFetch(bootRoutes())

    renderApp()

    await vi.waitFor(() => {
      expect(connectSpy).toHaveBeenCalledTimes(1)
      expect(unsubscribe).not.toHaveBeenCalled()
    })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some(u => u.includes('/api/events?since=0'))).toBe(true)
  })

  it('disconnects the event stream on unmount', async () => {
    const unsubscribe = vi.fn()
    const connectSpy = vi.spyOn(apiClient, 'connectStream').mockReturnValue(unsubscribe)
    mockFetch(bootRoutes())

    const { unmount } = renderApp()

    await vi.waitFor(() => {
      expect(connectSpy).toHaveBeenCalledTimes(1)
      expect(unsubscribe).not.toHaveBeenCalled()
    })

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('App — restored data after refresh', () => {
  it('shows server data on the initial render when the backend log contains events', async () => {
    mockFetch(restoredRoutes())

    renderApp()

    // The GET /api/events?since=0 route returns a ListCreated event for
    // "Restored List". The initially mounted ListsScreen must show it after
    // loadData resolves — WITHOUT any navigation or remount.
    await screen.findByText('Restored List')
  })

  it('still shows the empty state when the backend log is truly empty', async () => {
    mockFetch(bootRoutes())

    renderApp()

    await screen.findByText('No lists yet. Create one to get started.')
  })
})

describe('App — offline-first boot from localStorage', () => {
  it('renders restored data even when the network pull fails (offline boot)', async () => {
    seedSnapshot({
      lists: [{ id: 'list-offline', name: 'Offline List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' }],
      lastSeq: 7,
    })
    const stream = sseRoute()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL): Promise<Response> => {
      if (String(url).includes('/api/events/stream')) return stream.route.response
      throw new Error('network down')
    }))

    renderApp()

    // Restored data shows immediately even though the pull (and POST) failed.
    await screen.findByText('Offline List')
  })

  it('opens the stream at the restored lastSeq AFTER the initial pull has completed', async () => {
    seedSnapshot({
      lists: [{ id: 'list-24', name: 'List 24', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' }],
      lastSeq: 24,
    })
    const stream = sseRoute()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=24', response: jsonResponse({ events: [], lastSeq: 24 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 24 }) },
      stream.route,
    ])

    renderApp()

    // Wait until the boot pull resolved and the restored data rendered, then
    // pin: the stream fetch uses since=24 and happens strictly after the
    // since=24 pull (never before it, and never with since=0).
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      const pullIdx = urls.findIndex(u => u.includes('/api/events?since=24'))
      const streamIdx = urls.findIndex(u => u.includes('/api/events/stream?since=24'))
      expect(pullIdx).toBeGreaterThanOrEqual(0)
      expect(streamIdx).toBeGreaterThan(pullIdx)
    })
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    const streamUrls = urls.filter(u => u.includes('/api/events/stream'))
    expect(streamUrls).toHaveLength(1)
    expect(streamUrls[0]).toContain('since=24')
  })
})

describe('App — broken stream (dev-proxy limitation)', () => {
  it('boots without unhandled rejection and falls back to polling when the stream route is broken', async () => {
    const rejections: unknown[] = []
    const handler = (err: unknown) => rejections.push(err)
    process.on('unhandledRejection', handler)
    try {
      const fetchMock = mockFetch([
        {
          method: 'GET',
          url: '/api/events?since=0',
          response: jsonResponse({
            events: [{
              id: 'evt-1',
              clientId: 'remote',
              lamport: 1,
              timestamp: '2026-08-09T10:00:00.000Z',
              entityId: 'list-1',
              type: 'ListCreated',
              payload: { name: 'Restored List' },
              seq: 1,
            }],
            lastSeq: 1,
          }),
        },
        { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
        { method: 'GET', url: '/api/events?since=1', response: jsonResponse({ events: [], lastSeq: 1 }) },
        // deliberately NO /api/events/stream route: the stream fetch throws,
        // like the dev proxy after it has already relayed one stream.
      ])

      renderApp()

      // the initial pull still boots the app
      await screen.findByText('Restored List')

      // no unhandled rejection: the transport reports the stream failure and
      // the client falls back to polling (a poll GET fires within the interval)
      await vi.waitFor(() => {
        const urls = fetchMock.mock.calls.map(([url]) => String(url))
        expect(urls.some(u => u.includes('/api/events?since='))).toBe(true)
      }, { timeout: 7000 })
      expect(rejections).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', handler)
    }
  })
})
