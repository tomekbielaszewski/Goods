import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { apiClient } from './api/client'
import { useStore } from './store/useStore'

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

const bootRoutes = (): Route[] => [
  { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [], lastSeq: 0 }) },
  { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 0 }) },
]

beforeEach(() => {
  apiClient.reset()
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
