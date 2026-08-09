import type { AppEvent } from '../types/event'

export type ServerEvent = AppEvent & { seq: number }

const jsonCache = new WeakMap<Response, Promise<unknown>>()

function readJson(res: Response): Promise<unknown> {
  let cached = jsonCache.get(res)
  if (!cached) {
    cached = res.json()
    jsonCache.set(res, cached)
  }
  return cached
}

export async function fetchRemoteEvents(
  sinceSeq: number,
): Promise<{ events: ServerEvent[]; lastSeq: number }> {
  const res = await fetch(`/api/events?since=${sinceSeq}`)
  if (!res.ok) throw new Error(`Failed to fetch events (${res.status})`)
  return readJson(res) as Promise<{ events: ServerEvent[]; lastSeq: number }>
}

export async function publishPendingEvents(
  events: AppEvent[],
): Promise<{ accepted: number; duplicates: number; lastSeq: number }> {
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  })
  if (!res.ok) throw new Error(`Failed to publish events (${res.status})`)
  return readJson(res) as Promise<{ accepted: number; duplicates: number; lastSeq: number }>
}

export function subscribeEventStream(
  sinceSeq: number,
  onEvent: (e: ServerEvent) => void,
): () => void {
  const controller = new AbortController()
  void (async () => {
    try {
      const res = await fetch(`/api/events/stream?since=${sinceSeq}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`Failed to open event stream (${res.status})`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (line.startsWith('data:')) {
            onEvent(JSON.parse(line.slice(5).trim()) as ServerEvent)
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      throw err
    }
  })()
  return () => controller.abort()
}
