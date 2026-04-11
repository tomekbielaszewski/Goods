import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
    syncFailed: false,
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

const getDot = (container: HTMLElement) =>
  container.querySelector('.rounded-full') as HTMLElement

describe('SyncStatusBar', () => {
  it('always renders even when status is idle and there are no conflicts', () => {
    useStore.setState({ syncStatus: 'idle', conflicts: [] })
    const { container } = renderBar()
    expect(container.firstChild).not.toBeNull()
  })

  it('shows a gray dot when status is idle', () => {
    useStore.setState({ syncStatus: 'idle', conflicts: [] })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-gray-600')
  })

  it('shows a green dot when status is syncing with no prior failure', () => {
    useStore.setState({ syncStatus: 'syncing', syncFailed: false })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-green-400')
  })

  it('shows a green dot when status is synced', () => {
    useStore.setState({ syncStatus: 'synced', syncFailed: false })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-green-400')
  })

  it('transitions from synced to idle after 600ms, showing gray dot', () => {
    vi.useFakeTimers()
    useStore.setState({ syncStatus: 'synced', syncFailed: false })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-green-400')
    act(() => { vi.advanceTimersByTime(600) })
    expect(getDot(container)).toHaveClass('bg-gray-600')
    vi.useRealTimers()
  })

  it('shows a red dot when status is offline', () => {
    useStore.setState({ syncStatus: 'offline', syncFailed: true })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-red-500')
  })

  it('shows a red dot when status is error', () => {
    useStore.setState({ syncStatus: 'error', syncFailed: true })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-red-500')
  })

  it('keeps red dot while syncing after a prior failure', () => {
    useStore.setState({ syncStatus: 'syncing', syncFailed: true })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-red-500')
  })

  it('clears red dot to green when synced after a prior failure', () => {
    vi.useFakeTimers()
    useStore.setState({ syncStatus: 'synced', syncFailed: false })
    const { container } = renderBar()
    expect(getDot(container)).toHaveClass('bg-green-400')
    vi.useRealTimers()
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
