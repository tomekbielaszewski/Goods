import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SyncStatusBar from './SyncStatusBar'
import { useStore } from '../store/useStore'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const resetStore = () =>
  useStore.setState({
    syncStatus: 'idle',
    conflicts: [],
    lastSyncedAt: null,
    shoppingModeShopId: null,
    sortModes: {},
  })

beforeEach(() => {
  resetStore()
  mockNavigate.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const renderBar = () =>
  render(
    <MemoryRouter>
      <SyncStatusBar />
    </MemoryRouter>
  )

describe('SyncStatusBar', () => {
  it('returns null when status is idle and there are no conflicts', () => {
    useStore.setState({ syncStatus: 'idle', conflicts: [] })
    const { container } = renderBar()
    expect(container.firstChild).toBeNull()
  })

  it('shows "Syncing…" text when status is syncing', () => {
    useStore.setState({ syncStatus: 'syncing' })
    renderBar()
    expect(screen.getByText('Syncing…')).toBeInTheDocument()
  })

  it('shows spinner svg when syncing', () => {
    useStore.setState({ syncStatus: 'syncing' })
    const { container } = renderBar()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows "Offline" when status is offline', () => {
    useStore.setState({ syncStatus: 'offline' })
    renderBar()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('shows "Sync error" when status is error', () => {
    useStore.setState({ syncStatus: 'error' })
    renderBar()
    expect(screen.getByText('Sync error')).toBeInTheDocument()
  })

  it('renders when status is idle but conflicts exist', () => {
    useStore.setState({
      syncStatus: 'idle',
      conflicts: [{ entity: 'item', id: 'i1', client: {}, server: {} }],
    })
    const { container } = renderBar()
    expect(container.firstChild).not.toBeNull()
  })

  it('shows conflict count with amber color for 1 conflict', () => {
    useStore.setState({
      syncStatus: 'idle',
      conflicts: [{ entity: 'item', id: 'i1', client: {}, server: {} }],
    })
    renderBar()
    const btn = screen.getByRole('button', { name: /conflict/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveClass('text-amber-400')
    expect(btn.textContent).toContain('1')
    expect(btn.textContent).toContain('conflict')
  })

  it('uses plural "conflicts" when multiple conflicts exist', () => {
    useStore.setState({
      syncStatus: 'idle',
      conflicts: [
        { entity: 'item', id: 'i1', client: {}, server: {} },
        { entity: 'shop', id: 's1', client: {}, server: {} },
      ],
    })
    renderBar()
    const btn = screen.getByRole('button', { name: /conflicts/i })
    expect(btn.textContent).toContain('2')
    expect(btn.textContent).toContain('conflicts')
  })

  it('uses singular "conflict" when exactly 1 conflict exists', () => {
    useStore.setState({
      syncStatus: 'idle',
      conflicts: [{ entity: 'item', id: 'i1', client: {}, server: {} }],
    })
    renderBar()
    const btn = screen.getByRole('button')
    expect(btn.textContent).not.toContain('conflicts')
    expect(btn.textContent).toContain('conflict')
  })

  it('clicking conflict button navigates to /conflicts', async () => {
    const user = userEvent.setup()
    useStore.setState({
      syncStatus: 'idle',
      conflicts: [{ entity: 'item', id: 'i1', client: {}, server: {} }],
    })
    renderBar()
    await user.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith('/conflicts')
  })
})
