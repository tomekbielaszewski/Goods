import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SortMode, Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem } from '../types'

const mockApi = {
  reset: vi.fn(),
  getShops: vi.fn(),
  createShop: vi.fn(),
  updateShop: vi.fn(),
  deleteShop: vi.fn(),
  getTags: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getItemsWithDetails: vi.fn(),
  getItemWithDetails: vi.fn(),
  upsertItem: vi.fn(),
  addItemToShop: vi.fn(),
  removeItemFromShop: vi.fn(),
  getItemsForShop: vi.fn(),
  isEmpty: vi.fn(),
  getLists: vi.fn(),
  upsertList: vi.fn(),
  deleteList: vi.fn(),
  cloneList: vi.fn(),
  getListItemsWithItems: vi.fn(),
  upsertListItem: vi.fn(),
  updateListItemState: vi.fn(),
  skipShopForListItem: vi.fn(),
  clearSkipForListItem: vi.fn(),
  getFrequentItems: vi.fn(),
  createShoppingSession: vi.fn(),
  recordSessionItem: vi.fn(),
  getSessionItems: vi.fn(),
}

vi.mock('../api/client', () => ({
  apiClient: mockApi,
}))

import { useStore } from './useStore'

const resetStore = () =>
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

beforeEach(() => {
  localStorage.clear()
  resetStore()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Default state ──────────────────────────────────────────────────────────────

describe('useStore — default state', () => {
  it('has all data arrays empty', () => {
    const state = useStore.getState()
    expect(state.shops).toEqual([])
    expect(state.items).toEqual([])
    expect(state.tags).toEqual([])
    expect(state.lists).toEqual([])
    expect(state.listItems).toEqual([])
    expect(state.shoppingSessions).toEqual([])
    expect(state.sessionItems).toEqual([])
    expect(state.itemShops).toEqual([])
    expect(state.itemTags).toEqual([])
    expect(state.listItemSkippedShops).toEqual([])
  })

  it('has UI state defaults', () => {
    const state = useStore.getState()
    expect(state.shoppingModeShopId).toBeNull()
    expect(state.sortModes).toEqual({})
  })
})

// ── loadData ───────────────────────────────────────────────────────────────────

describe('useStore — loadData', () => {
  it('populates all arrays from apiClient', async () => {
    const shops: Shop[] = [{ id: 's1', name: 'Shop', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }]
    const tags: Tag[] = [{ id: 't1', name: 'dairy' }]
    const lists: List[] = [{ id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }]
    const listItems: ListItem[] = [{ id: 'li1', listId: 'l1', itemId: 'i1', state: 'active', version: 1, addedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }]
    const sessions: ShoppingSession[] = [{ id: 'ss1', listId: 'l1', shopId: 's1', startedAt: '2024-01-01T00:00:00Z', version: 1 }]
    const sessionItems: SessionItem[] = [{ id: 'si1', sessionId: 'ss1', itemId: 'i1', action: 'bought', at: '2024-01-01T00:00:00Z' }]
    const itemShops = [{ itemId: 'i1', shopId: 's1' }]
    const itemTags = [{ itemId: 'i1', tagId: 't1' }]
    const listItemSkippedShops = [{ listItemId: 'li1', shopId: 's1', skippedAt: '2024-01-01T00:00:00Z' }]

    mockApi.getShops.mockResolvedValue(shops)
    mockApi.getTags.mockResolvedValue(tags)
    mockApi.getItemsWithDetails.mockResolvedValue([])
    mockApi.getLists.mockResolvedValue(lists)
    mockApi.getListItemsWithItems.mockResolvedValue([])
    mockApi.getFrequentItems.mockResolvedValue([])

    await useStore.getState().loadData()

    const state = useStore.getState()
    expect(state.shops).toEqual(shops)
    expect(state.tags).toEqual(tags)
    expect(state.lists).toEqual(lists)
  })
})

// ── Shop actions ───────────────────────────────────────────────────────────────

describe('useStore — shop actions', () => {
  it('addShop calls apiClient.createShop and updates state', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    mockApi.createShop.mockResolvedValue(shop)

    await useStore.getState().addShop({ name: 'New', color: '#f00' })
    expect(mockApi.createShop).toHaveBeenCalledWith({ name: 'New', color: '#f00' })
    expect(useStore.getState().shops).toEqual([shop])
  })

  it('updateShop calls apiClient.updateShop and updates state', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    const updated: Shop = { ...shop, name: 'Updated', version: 2 }
    useStore.setState({ shops: [shop] })
    mockApi.updateShop.mockResolvedValue(updated)

    await useStore.getState().updateShop('s1', { name: 'Updated' })
    expect(mockApi.updateShop).toHaveBeenCalledWith('s1', { name: 'Updated' })
    expect(useStore.getState().shops[0]!.name).toBe('Updated')
  })

  it('deleteShop calls apiClient.deleteShop and removes from state', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    useStore.setState({ shops: [shop] })
    mockApi.deleteShop.mockResolvedValue(undefined)

    await useStore.getState().deleteShop('s1')
    expect(mockApi.deleteShop).toHaveBeenCalledWith('s1')
    expect(useStore.getState().shops).toEqual([])
  })
})

// ── Tag actions ────────────────────────────────────────────────────────────────

describe('useStore — tag actions', () => {
  it('addTag calls apiClient.createTag and updates state', async () => {
    const tag: Tag = { id: 't1', name: 'dairy' }
    mockApi.createTag.mockResolvedValue(tag)

    await useStore.getState().addTag('dairy')
    expect(mockApi.createTag).toHaveBeenCalledWith('dairy')
    expect(useStore.getState().tags).toEqual([tag])
  })
})

// ── Item actions ───────────────────────────────────────────────────────────────

describe('useStore — item actions', () => {
  it('upsertItem calls apiClient.upsertItem', async () => {
    const item = { id: 'i1', name: 'Milk', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' } as Item
    mockApi.upsertItem.mockResolvedValue(item)

    await useStore.getState().upsertItem(item, ['s1'], ['t1'])
    expect(mockApi.upsertItem).toHaveBeenCalledWith(item, ['s1'], ['t1'])
  })

  it('addItemToShop calls apiClient.addItemToShop', async () => {
    mockApi.addItemToShop.mockResolvedValue(undefined)
    await useStore.getState().addItemToShop('i1', 's1')
    expect(mockApi.addItemToShop).toHaveBeenCalledWith('i1', 's1')
  })

  it('removeItemFromShop calls apiClient.removeItemFromShop', async () => {
    mockApi.removeItemFromShop.mockResolvedValue(undefined)
    await useStore.getState().removeItemFromShop('i1', 's1')
    expect(mockApi.removeItemFromShop).toHaveBeenCalledWith('i1', 's1')
  })
})

// ── List actions ───────────────────────────────────────────────────────────────

describe('useStore — list actions', () => {
  it('upsertList calls apiClient.upsertList and updates state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    mockApi.upsertList.mockResolvedValue(list)

    await useStore.getState().upsertList(list)
    expect(mockApi.upsertList).toHaveBeenCalledWith(list)
    expect(useStore.getState().lists).toEqual([list])
  })

  it('deleteList calls apiClient.deleteList and removes from state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    useStore.setState({ lists: [list] })
    mockApi.deleteList.mockResolvedValue(undefined)

    await useStore.getState().deleteList('l1')
    expect(mockApi.deleteList).toHaveBeenCalledWith('l1')
    expect(useStore.getState().lists).toEqual([])
  })

  it('cloneList calls apiClient.cloneList and adds to state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    const cloned: List = { ...list, id: 'l2', name: 'Copy of List' }
    useStore.setState({ lists: [list] })
    mockApi.cloneList.mockResolvedValue(cloned)

    await useStore.getState().cloneList('l1')
    expect(mockApi.cloneList).toHaveBeenCalledWith('l1')
    expect(useStore.getState().lists).toHaveLength(2)
  })
})

// ── ListItem actions ───────────────────────────────────────────────────────────

describe('useStore — listItem actions', () => {
  it('upsertListItem calls apiClient.upsertListItem', async () => {
    const li: ListItem = { id: 'li1', listId: 'l1', itemId: 'i1', state: 'active', version: 1, addedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    mockApi.upsertListItem.mockResolvedValue(li)

    await useStore.getState().upsertListItem(li)
    expect(mockApi.upsertListItem).toHaveBeenCalledWith(li)
  })

  it('updateListItemState calls apiClient.updateListItemState', async () => {
    const li: ListItem = { id: 'li1', listId: 'l1', itemId: 'i1', state: 'active', version: 1, addedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    const updated: ListItem = { ...li, state: 'bought' }
    useStore.setState({ listItems: [li] })
    mockApi.updateListItemState.mockResolvedValue(updated)

    await useStore.getState().updateListItemState('li1', 'bought')
    expect(mockApi.updateListItemState).toHaveBeenCalledWith('li1', 'bought')
  })

  it('skipShopForListItem calls apiClient.skipShopForListItem', async () => {
    mockApi.skipShopForListItem.mockResolvedValue(undefined)
    await useStore.getState().skipShopForListItem('li1', 's1')
    expect(mockApi.skipShopForListItem).toHaveBeenCalledWith('li1', 's1')
  })

  it('clearSkipForListItem calls apiClient.clearSkipForListItem', async () => {
    mockApi.clearSkipForListItem.mockResolvedValue(undefined)
    await useStore.getState().clearSkipForListItem('li1', 's1')
    expect(mockApi.clearSkipForListItem).toHaveBeenCalledWith('li1', 's1')
  })
})

// ── Session actions ────────────────────────────────────────────────────────────

describe('useStore — session actions', () => {
  it('createShoppingSession calls apiClient.createShoppingSession', async () => {
    const session: ShoppingSession = { id: 'ss1', listId: 'l1', shopId: 's1', startedAt: '2024-01-01T00:00:00Z', version: 1 }
    mockApi.createShoppingSession.mockResolvedValue(session)

    await useStore.getState().createShoppingSession('l1', 's1')
    expect(mockApi.createShoppingSession).toHaveBeenCalledWith('l1', 's1')
  })

  it('recordSessionItem calls apiClient.recordSessionItem', async () => {
    const si = { sessionId: 'ss1', itemId: 'i1', action: 'bought' as const, at: '2024-01-01T00:00:00Z' }
    mockApi.recordSessionItem.mockResolvedValue({ id: 'si1', ...si })

    await useStore.getState().recordSessionItem(si)
    expect(mockApi.recordSessionItem).toHaveBeenCalledWith(si)
  })
})

// ── shopping mode (preserved from original) ────────────────────────────────────

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

// ── sortModes (preserved from original) ────────────────────────────────────────

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

  it('setSortMode writes sortModes to localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name' })
  })

  it('setSortMode accumulates multiple lists in localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    useStore.getState().setSortMode('list-2', 'frequency')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name', 'list-2': 'frequency' })
  })
})
