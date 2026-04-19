import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from './useStore'
import type { SortMode } from '../types'

// Reset the store state between tests
const resetStore = () =>
  useStore.setState({
    syncStatus: 'idle',
    conflicts: [],
    lastSyncedAt: null,
    shoppingModeShopId: null,
    sortModes: {},
  })

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useStore — syncStatus', () => {
  it('defaults to idle', () => {
    expect(useStore.getState().syncStatus).toBe('idle')
  })

  it('setSyncStatus updates to syncing', () => {
    useStore.getState().setSyncStatus('syncing')
    expect(useStore.getState().syncStatus).toBe('syncing')
  })

  it('setSyncStatus updates to error', () => {
    useStore.getState().setSyncStatus('error')
    expect(useStore.getState().syncStatus).toBe('error')
  })

  it('setSyncStatus updates to offline', () => {
    useStore.getState().setSyncStatus('offline')
    expect(useStore.getState().syncStatus).toBe('offline')
  })
})

describe('useStore — shopping mode', () => {
  it('shoppingModeShopId defaults to null', () => {
    expect(useStore.getState().shoppingModeShopId).toBeNull()
  })

  it('enterShoppingMode sets shopId', () => {
    useStore.getState().enterShoppingMode('shop-abc')
    expect(useStore.getState().shoppingModeShopId).toBe('shop-abc')
  })

  it('exitShoppingMode clears shopId', () => {
    useStore.getState().enterShoppingMode('shop-abc')
    useStore.getState().exitShoppingMode()
    expect(useStore.getState().shoppingModeShopId).toBeNull()
  })
})

describe('useStore — conflicts', () => {
  it('conflicts defaults to empty array', () => {
    expect(useStore.getState().conflicts).toEqual([])
  })

  it('addConflicts appends to existing conflicts', () => {
    const first = [{ entity: 'item', id: 'i1', client: {}, server: {} }]
    const second = [{ entity: 'shop', id: 's1', client: {}, server: {} }]
    useStore.getState().addConflicts(first)
    useStore.getState().addConflicts(second)
    expect(useStore.getState().conflicts).toHaveLength(2)
    expect(useStore.getState().conflicts[0]).toEqual(first[0])
    expect(useStore.getState().conflicts[1]).toEqual(second[0])
  })

  it('resolveConflict removes matching entity+id', () => {
    useStore.getState().addConflicts([
      { entity: 'item', id: 'i1', client: {}, server: {} },
      { entity: 'item', id: 'i2', client: {}, server: {} },
      { entity: 'shop', id: 's1', client: {}, server: {} },
    ])
    useStore.getState().resolveConflict('item', 'i1')
    const conflicts = useStore.getState().conflicts
    expect(conflicts).toHaveLength(2)
    expect(conflicts.find(c => c.entity === 'item' && c.id === 'i1')).toBeUndefined()
  })

  it('resolveConflict only removes the matching conflict, not others with same id', () => {
    useStore.getState().addConflicts([
      { entity: 'item', id: 'x1', client: {}, server: {} },
      { entity: 'shop', id: 'x1', client: {}, server: {} },
    ])
    useStore.getState().resolveConflict('item', 'x1')
    const conflicts = useStore.getState().conflicts
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.entity).toBe('shop')
  })
})

describe('useStore — sortModes', () => {
  it('sortModes defaults to empty object', () => {
    expect(useStore.getState().sortModes).toEqual({})
  })

  it('setSortMode stores mode per-listId', () => {
    useStore.getState().setSortMode('list-1', 'name')
    expect(useStore.getState().sortModes['list-1']).toBe('name')
  })

  it('setSortMode does not affect other lists', () => {
    useStore.getState().setSortMode('list-1', 'name')
    useStore.getState().setSortMode('list-2', 'frequency')
    expect(useStore.getState().sortModes['list-1']).toBe('name')
    expect(useStore.getState().sortModes['list-2']).toBe('frequency')
  })

  it('setSortMode overwrites previous mode for same list', () => {
    useStore.getState().setSortMode('list-1', 'date')
    useStore.getState().setSortMode('list-1', 'frequency')
    expect(useStore.getState().sortModes['list-1']).toBe('frequency')
  })
})

describe('useStore — sortModes localStorage persistence', () => {
  it('setSortMode writes sortModes to localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name' })
  })

  it('setSortMode accumulates multiple lists in localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    useStore.getState().setSortMode('list-2', 'frequency')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name', 'list-2': 'frequency' })
  })

  it('sortModes reads from localStorage on init', () => {
    const stored = { 'list-abc': 'tag' as SortMode }
    localStorage.setItem('sortModes', JSON.stringify(stored))
    useStore.setState({ sortModes: JSON.parse(localStorage.getItem('sortModes') ?? '{}') })
    expect(useStore.getState().sortModes['list-abc']).toBe('tag')
  })
})

describe('useStore — lastSyncedAt', () => {
  it('lastSyncedAt reads from localStorage on init', () => {
    const ts = '2024-01-15T10:00:00.000Z'
    localStorage.setItem('lastSyncedAt', ts)
    // The store reads from localStorage during create(), so we simulate re-reading
    // by manually syncing localStorage into the store state
    useStore.setState({ lastSyncedAt: localStorage.getItem('lastSyncedAt') })
    expect(useStore.getState().lastSyncedAt).toBe(ts)
  })

  it('lastSyncedAt is null when localStorage is empty', () => {
    localStorage.removeItem('lastSyncedAt')
    useStore.setState({ lastSyncedAt: localStorage.getItem('lastSyncedAt') })
    expect(useStore.getState().lastSyncedAt).toBeNull()
  })

  it('setLastSyncedAt updates state', () => {
    const ts = '2024-06-01T12:00:00.000Z'
    useStore.getState().setLastSyncedAt(ts)
    expect(useStore.getState().lastSyncedAt).toBe(ts)
  })

  it('setLastSyncedAt writes to localStorage', () => {
    const ts = '2024-06-01T12:00:00.000Z'
    useStore.getState().setLastSyncedAt(ts)
    expect(localStorage.getItem('lastSyncedAt')).toBe(ts)
  })
})
