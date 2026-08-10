import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import BugReportsScreen from './BugReportsScreen'
import { apiClient } from '../api/client'

interface BugReport {
  id: string
  text: string
  created_at: string
  resolved_at: string | null
}

const makeReport = (id: string, text: string, resolvedAt: string | null = null): BugReport => ({
  id, text, created_at: '2026-08-09T10:00:00.000Z', resolved_at: resolvedAt,
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stubFetch = (reports: BugReport[] | null, opts: { rejectGet?: boolean; rejectResolve?: boolean } = {}) => {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (opts.rejectGet && method === 'GET' && u === '/api/bug-reports') {
      throw new Error('network down')
    }
    if (method === 'GET' && u === '/api/bug-reports') {
      return jsonResponse(reports ?? [])
    }
    if (method === 'POST' && u.includes('/api/bug-reports/') && u.endsWith('/resolve')) {
      if (opts.rejectResolve) throw new Error('network down')
      return jsonResponse({ ok: true })
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const stubClipboard = (opts: { reject?: boolean } = {}) => {
  const writeText = vi.fn().mockImplementation(
    opts.reject ? () => Promise.reject(new Error('denied')) : () => Promise.resolve()
  )
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  return writeText
}

const renderBugReports = () =>
  render(
    <MemoryRouter initialEntries={['/bug-reports']}>
      <Routes>
        <Route path="/bug-reports" element={<BugReportsScreen />} />
        <Route path="/settings" element={<div>settings screen</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  apiClient.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BugReportsScreen — rendering', () => {
  it('shows loading while reports are fetched, then renders them', async () => {
    stubFetch([makeReport('r1', 'Crash on startup')])

    renderBugReports()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Crash on startup')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('sorts unresolved reports before resolved ones', async () => {
    stubFetch([
      makeReport('r1', 'Resolved issue', '2026-08-09T12:00:00.000Z'),
      makeReport('r2', 'Open issue'),
    ])

    renderBugReports()

    const texts = await screen.findAllByText(/issue/)
    expect(texts[0]).toHaveTextContent('Open issue')
    expect(texts[1]).toHaveTextContent('Resolved issue')
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(screen.getByText('Resolved issue')).toHaveClass('line-through')
  })

  it('shows the empty state when there are no reports', async () => {
    stubFetch([])

    renderBugReports()

    expect(await screen.findByText('No bug reports yet.')).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    stubFetch(null, { rejectGet: true })

    renderBugReports()

    expect(await screen.findByText('Failed to load bug reports.')).toBeInTheDocument()
  })
})

describe('BugReportsScreen — resolving', () => {
  it('marks a report as resolved via the Done button', async () => {
    const fetchMock = stubFetch([makeReport('r1', 'Crash on startup')])
    const user = userEvent.setup()

    renderBugReports()

    await screen.findByText('Crash on startup')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/bug-reports/r1/resolve', { method: 'POST' })
    expect(await screen.findByText('Resolved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getByText('Crash on startup')).toHaveClass('line-through')
  })

  it('keeps the report unresolved when the resolve request fails', async () => {
    stubFetch([makeReport('r1', 'Crash on startup')], { rejectResolve: true })
    const user = userEvent.setup()

    renderBugReports()

    await screen.findByText('Crash on startup')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument()
  })
})

describe('BugReportsScreen — copy to clipboard', () => {
  it('copies the report text to the clipboard', async () => {
    // userEvent.setup() must run BEFORE vi.stubGlobal('navigator', …): the
    // setup replaces the global window, which wipes an earlier stub.
    const user = userEvent.setup()
    const writeText = stubClipboard()
    stubFetch([makeReport('r1', 'Crash on startup')])

    renderBugReports()

    await screen.findByText('Crash on startup')
    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Crash on startup')
    })
  })

  it('does not crash when clipboard access is denied', async () => {
    const user = userEvent.setup()
    stubClipboard({ reject: true })
    stubFetch([makeReport('r1', 'Crash on startup')])

    renderBugReports()

    await screen.findByText('Crash on startup')
    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }))
    expect(await screen.findByText('Crash on startup')).toBeInTheDocument()
  })
})

describe('BugReportsScreen — navigation', () => {
  it('navigates back to settings', async () => {
    stubFetch([])
    const user = userEvent.setup()

    renderBugReports()

    await screen.findByText('No bug reports yet.')
    await user.click(screen.getByRole('button', { name: 'Back to settings' }))
    expect(await screen.findByText('settings screen')).toBeInTheDocument()
  })
})
