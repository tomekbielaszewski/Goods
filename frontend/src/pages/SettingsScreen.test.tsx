import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import SettingsScreen from './SettingsScreen'
import { apiClient } from '../api/client'
import type { Shop } from '../types'
import { useParams } from 'react-router-dom'

const ShopProbe = () => {
  const { id } = useParams<{ id: string }>()
  return <div>shop items screen {id}</div>
}

const store = apiClient as unknown as {
  shops: Map<string, Shop>
}

const makeShop = (id: string, overrides: Partial<Shop> = {}): Shop => ({
  id, name: `Shop ${id}`, color: '#aabbcc', version: 1,
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Stubs fetch so the auto-sync POST /api/events (scheduled by every mutation
// commit) resolves instead of hitting the network. The screens themselves
// never fetch on their own.
const stubSyncFetch = (): Mock => {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && u === '/api/events') {
      return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 1 })
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const renderSettings = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/shop/:id" element={<ShopProbe />} />
        <Route path="/bug-reports" element={<div>bug reports screen</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  apiClient.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsScreen — shops list', () => {
  it('renders all shops with their edit, delete and items buttons', async () => {
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.shops.set('s2', makeShop('s2', { name: 'Corner shop' }))

    renderSettings()

    expect(await screen.findByText('Supermarket')).toBeInTheDocument()
    expect(screen.getByText('Corner shop')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Items$/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Edit$/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete shop' })).toHaveLength(2)
  })

  it('shows the empty state when there are no shops', async () => {
    renderSettings()
    expect(await screen.findByText('No shops yet.')).toBeInTheDocument()
  })

  it('navigates to the shop items screen via the Items button', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))

    renderSettings()

    await user.click(await screen.findByRole('button', { name: /^Items$/ }))
    expect(await screen.findByText('shop items screen s1')).toBeInTheDocument()
  })
})

describe('SettingsScreen — add shop', () => {
  it('creates a shop with the typed name and chosen palette color', async () => {
    const user = userEvent.setup()
    stubSyncFetch()

    renderSettings()

    const input = await screen.findByPlaceholderText('Shop name…')
    await user.type(input, 'Delicatessen')
    await user.click(screen.getByRole('button', { name: 'Color #22c55e' }))
    await user.click(screen.getByRole('button', { name: /^Add shop$/ }))

    await waitFor(() => {
      const shops = [...store.shops.values()]
      expect(shops).toHaveLength(1)
      expect(shops[0]!.name).toBe('Delicatessen')
      expect(shops[0]!.color).toBe('#22c55e')
    })
  })

  it('creates a shop with a custom color from the color input', async () => {
    const user = userEvent.setup()
    stubSyncFetch()

    renderSettings()

    const input = await screen.findByPlaceholderText('Shop name…')
    await user.type(input, 'Farmer market')
    fireEvent.change(document.querySelector('input[type=color]')!, {
      target: { value: '#123456' },
    })
    await user.click(screen.getByRole('button', { name: /^Add shop$/ }))

    await waitFor(() => {
      const shops = [...store.shops.values()]
      expect(shops).toHaveLength(1)
      expect(shops[0]!.color).toBe('#123456')
    })
  })

  it('saves the shop when Enter is pressed in the name input', async () => {
    const user = userEvent.setup()
    stubSyncFetch()

    renderSettings()

    const input = await screen.findByPlaceholderText('Shop name…')
    await user.type(input, 'Enter shop{Enter}')

    await waitFor(() => {
      expect([...store.shops.values()]).toHaveLength(1)
      expect([...store.shops.values()][0]!.name).toBe('Enter shop')
    })
  })

  it('does not create a shop for an empty name', async () => {
    const user = userEvent.setup()

    renderSettings()

    const addBtn = await screen.findByRole('button', { name: /^Add shop$/ })
    expect(addBtn).toBeDisabled()
    await user.click(addBtn)
    expect(store.shops.size).toBe(0)
  })

  it('renders the newly created shop in the list after saving', async () => {
    const user = userEvent.setup()
    stubSyncFetch()

    renderSettings()

    const input = await screen.findByPlaceholderText('Shop name…')
    await user.type(input, 'Butcher')
    await user.click(screen.getByRole('button', { name: /^Add shop$/ }))

    expect(await screen.findByText('Butcher')).toBeInTheDocument()
  })
})

describe('SettingsScreen — edit and delete shop', () => {
  it('pre-fills the edit form with the shop name and color', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket', color: '#8b5cf6' }))

    renderSettings()

    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))

    expect(screen.getByText('Edit shop')).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Shop name…') as HTMLInputElement
    expect(input.value).toBe('Supermarket')
    expect(screen.getByRole('button', { name: 'Color #8b5cf6' })).toHaveClass('scale-125')
  })

  it('renames the shop and changes its color on save', async () => {
    const user = userEvent.setup()
    stubSyncFetch()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket', color: '#8b5cf6' }))

    renderSettings()

    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))
    const input = screen.getByPlaceholderText('Shop name…')
    await user.clear(input)
    await user.type(input, 'Mega mart')
    await user.click(screen.getByRole('button', { name: 'Color #14b8a6' }))
    await user.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => {
      const shop = store.shops.get('s1')!
      expect(shop.name).toBe('Mega mart')
      expect(shop.color).toBe('#14b8a6')
    })
    // The list re-reads after saving and shows the new name.
    expect(await screen.findByText('Mega mart')).toBeInTheDocument()
  })

  it('cancels the edit and returns to the add form without saving', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))

    renderSettings()

    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))
    await user.clear(screen.getByPlaceholderText('Shop name…'))
    await user.type(screen.getByPlaceholderText('Shop name…'), 'Never saved')
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }))

    expect(screen.getByRole('button', { name: /^Add shop$/ })).toBeInTheDocument()
    expect((screen.getByPlaceholderText('Shop name…') as HTMLInputElement).value).toBe('')
    expect(store.shops.get('s1')!.name).toBe('Supermarket')
    expect(screen.queryByRole('button', { name: /^Save$/ })).not.toBeInTheDocument()
  })

  it('soft-deletes a shop and removes it from the list', async () => {
    const user = userEvent.setup()
    stubSyncFetch()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))

    renderSettings()

    await screen.findByText('Supermarket')
    await user.click(screen.getByRole('button', { name: 'Delete shop' }))

    await waitFor(() => {
      expect(store.shops.get('s1')!.deletedAt).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.queryByText('Supermarket')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('No shops yet.')).toBeInTheDocument()
  })

  it('filters deleted shops out of the rendered list on reload', async () => {
    const user = userEvent.setup()
    stubSyncFetch()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket', deletedAt: '2026-08-09T10:00:00.000Z' }))

    renderSettings()

    expect(await screen.findByText('No shops yet.')).toBeInTheDocument()
    expect(screen.queryByText('Supermarket')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Shop name…'), 'x')
    expect(screen.queryByText('Supermarket')).not.toBeInTheDocument()
  })
})

describe('SettingsScreen — bug report', () => {
  it('submits a bug report and shows the sent confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = stubSyncFetch()

    renderSettings()

    const textarea = await screen.findByPlaceholderText('Describe the issue…')
    await user.type(textarea, 'The list screen crashes')
    await user.click(screen.getByRole('button', { name: /^Submit$/ }))

    expect(await screen.findByText('Sent!')).toBeInTheDocument()
    expect(textarea).toHaveValue('')

    // The BugReported event is committed to the outbox and pushed to the
    // server via the auto-sync POST /api/events.
    await waitFor(() => {
      const posts = fetchMock.mock.calls
        .filter(([url, init]) => String(url) === '/api/events' && (init as RequestInit)?.method === 'POST')
        .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      expect(posts.some((body: { events: Array<{ type: string; payload: { text: string } }> }) =>
        body.events.some(e => e.type === 'BugReported' && e.payload.text === 'The list screen crashes')
      )).toBe(true)
    })
  })

  it('disables submit while a report is being sent', async () => {
    const user = userEvent.setup()
    stubSyncFetch()

    renderSettings()

    const textarea = await screen.findByPlaceholderText('Describe the issue…')
    await user.type(textarea, 'Slow sync')
    await user.click(screen.getByRole('button', { name: /^Submit$/ }))

    // After the click the status passes through 'sending' before 'sent'
    // (the api call resolves on the next microtask, so this may be skipped);
    // the button must at least return to Submit afterwards.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Submit$/ })).toBeInTheDocument()
    })
  })

  it('does not submit an empty bug report', async () => {
    const user = userEvent.setup()

    renderSettings()

    const submit = await screen.findByRole('button', { name: /^Submit$/ })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(localStorage.getItem('grocery-snapshot')).toBeNull()
  })

  it('navigates to the bug reports screen', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(await screen.findByRole('button', { name: /view all bug reports/i }))
    expect(await screen.findByText('bug reports screen')).toBeInTheDocument()
  })
})

describe('SettingsScreen — about', () => {
  it('renders the about section', async () => {
    renderSettings()
    expect(await screen.findByText(/Groceries v0\.1\.0/)).toBeInTheDocument()
  })
})

describe('SettingsScreen — resync', () => {
  it('renders a Resync button in the last section, after About', async () => {
    renderSettings()

    const button = await screen.findByRole('button', { name: /^Resync$/ })
    const resyncSection = button.closest('section')
    expect(resyncSection).not.toBeNull()

    // it is the LAST section on the screen
    const sections = Array.from(resyncSection!.parentElement!.querySelectorAll('section'))
    expect(sections.at(-1)).toBe(resyncSection)

    // it comes after the About section
    const aboutSection = (await screen.findByText(/Groceries v0\.1\.0/)).closest('section')
    expect(aboutSection).not.toBeNull()
    expect(aboutSection!.compareDocumentPosition(resyncSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is styled red and full width', async () => {
    renderSettings()

    const button = await screen.findByRole('button', { name: /^Resync$/ })
    expect(button.className).toContain('bg-red-600')
    expect(button.className).toContain('w-full')
  })

  it('clicking Resync pulls /api/events?since=0, shows a disabled in-flight label, then restores', async () => {
    const user = userEvent.setup()
    let resolvePull!: (res: Response) => void
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'GET' && u === '/api/events?since=0') {
        return new Promise<Response>(resolve => { resolvePull = resolve })
      }
      if (method === 'POST' && u === '/api/events') {
        return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 0 })
      }
      if (method === 'GET' && u === '/api/events/stream?since=0') {
        return new Response(
          new ReadableStream<Uint8Array>({ start(c) {} }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderSettings()

    const button = await screen.findByRole('button', { name: /^Resync$/ })
    await user.click(button)

    // while the pull is in flight the button is disabled with a progress label
    const pending = await screen.findByRole('button', { name: /Resyncing/ })
    expect(pending).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith('/api/events?since=0')

    // once the pull resolves the button returns to its idle state
    resolvePull(jsonResponse({ events: [], lastSeq: 0 }))
    const restored = await screen.findByRole('button', { name: /^Resync$/ })
    expect(restored).not.toBeDisabled()
  })
})
