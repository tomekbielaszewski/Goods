import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchRemoteEvents, publishPendingEvents, subscribeEventStream } from './transport'
import type { ServerEvent } from './transport'

// ── Helpers ────────────────────────────────────────────────────────────────────

// Remote events carry the full envelope (id, clientId, lamport, timestamp,
// entityId, type) plus a server-assigned seq.
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// A controllable SSE source: enqueue frames as `data: <json>\n` lines (matching
// the Go stream handler), then close when done.
function sseStream(): {
  stream: ReadableStream<Uint8Array>
  feed: (ev: ServerEvent) => void
  close: () => void
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const encoder = new TextEncoder()
  return {
    stream,
    feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
    close: () => controller.close(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── fetchRemoteEvents ──────────────────────────────────────────────────────────

describe('fetchRemoteEvents', () => {
  it('GETs /api/events?since=0 and returns parsed events + lastSeq', async () => {
    const ev = remoteEvent('ShopCreated', 'shop-1', { name: 'Lidl', color: '#ff0000' }, 1, 3)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ events: [ev], lastSeq: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchRemoteEvents(0)

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/events?since=0')
    expect(result).toEqual({ events: [ev], lastSeq: 1 })
  })

  it('fetches the given since seq (42)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ events: [], lastSeq: 42 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchRemoteEvents(42)

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/events?since=42')
    expect(result.lastSeq).toBe(42)
  })

  it('propagates a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRemoteEvents(0)).rejects.toThrow('network down')
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRemoteEvents(0)).rejects.toThrow()
  })
})

// ── publishPendingEvents ───────────────────────────────────────────────────────

describe('publishPendingEvents', () => {
  it('POSTs {"events":[...]} as JSON and returns the parsed response', async () => {
    const evs: ServerEvent[] = [
      remoteEvent('ShopCreated', 'shop-1', { name: 'A', color: '#000' }, 0, 1),
      remoteEvent('TagCreated', 'tag-1', { name: 'x' }, 0, 2),
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 2, duplicates: 0, lastSeq: 5 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishPendingEvents(evs)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    )
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual({ events: evs })
    expect(result).toEqual({ accepted: 2, duplicates: 0, lastSeq: 5 })
  })

  it('propagates a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishPendingEvents([])).rejects.toThrow('network down')
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishPendingEvents([])).rejects.toThrow()
  })
})

// ── subscribeEventStream ───────────────────────────────────────────────────────

describe('subscribeEventStream', () => {
  it('calls onEvent once per SSE data frame', async () => {
    const { stream, feed, close } = sseStream()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ev1 = remoteEvent('ShopCreated', 'shop-1', { name: 'A', color: '#000' }, 1, 1)
    const ev2 = remoteEvent('ListCreated', 'list-1', { name: 'L' }, 2, 2)
    const received: ServerEvent[] = []

    const unsubscribe = subscribeEventStream(0, e => received.push(e))
    feed(ev1)
    feed(ev2)
    close()
    await tick()

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual(ev1)
    expect(received[1]).toEqual(ev2)
    unsubscribe()
  })

  it('passes an AbortSignal and stops delivery when unsubscribed', async () => {
    const { stream, feed, close } = sseStream()
    // Model real fetch: aborting the signal cancels the response body.
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', close)
      return Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const received: ServerEvent[] = []

    const unsubscribe = subscribeEventStream(3, e => received.push(e))
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(String(fetchMock.mock.calls[0]![0])).toContain('?since=3')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    feed(remoteEvent('ShopCreated', 'shop-1', { name: 'A', color: '#000' }, 1, 1))
    await tick()
    expect(received).toHaveLength(1)

    unsubscribe()
    await tick()
    expect((init.signal as AbortSignal).aborted).toBe(true)

    try {
      feed(remoteEvent('TagCreated', 'tag-1', { name: 'x' }, 2, 2))
    } catch {
      // The source controller is closed by the abort — no further frames possible.
    }
    await tick()
    expect(received).toHaveLength(1)
  })
})
