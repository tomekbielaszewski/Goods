import { create } from 'zustand'
import type {
  SortMode,
  Shop, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
  Item,
} from '../types'
import { apiClient } from '../api/client'

interface AppStore {
  shoppingModeShopId: string | null
  sortModes: Record<string, SortMode>

  shops: Shop[]
  items: Item[]
  tags: Tag[]
  lists: List[]
  listItems: ListItem[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]

  enterShoppingMode: (shopId: string) => void
  exitShoppingMode: () => void
  setSortMode: (listId: string, mode: SortMode) => void

  loadData: () => Promise<void>
  addShop: (input: Omit<Shop, 'id' | 'version' | 'updatedAt'>) => Promise<void>
  updateShop: (id: string, patch: Partial<Shop>) => Promise<void>
  deleteShop: (id: string) => Promise<void>
  addTag: (name: string) => Promise<void>
  upsertItem: (item: Item, shopIds: string[], tagIds: string[]) => Promise<void>
  addItemToShop: (itemId: string, shopId: string) => Promise<void>
  removeItemFromShop: (itemId: string, shopId: string) => Promise<void>
  upsertList: (list: List) => Promise<void>
  deleteList: (id: string) => Promise<void>
  cloneList: (id: string) => Promise<void>
  upsertListItem: (li: ListItem) => Promise<void>
  updateListItemState: (id: string, state: 'active' | 'bought') => Promise<void>
  skipShopForListItem: (liId: string, shopId: string) => Promise<void>
  clearSkipForListItem: (liId: string, shopId: string) => Promise<void>
  createShoppingSession: (listId: string, shopId: string) => Promise<void>
  recordSessionItem: (input: { sessionId: string; itemId: string; action: 'bought' | 'skipped'; at: string }) => Promise<void>
}

export const useStore = create<AppStore>((set) => ({
  shoppingModeShopId: null,
  sortModes: JSON.parse(localStorage.getItem('sortModes') ?? '{}') as Record<string, SortMode>,

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

  enterShoppingMode: (shopId) => set({ shoppingModeShopId: shopId }),
  exitShoppingMode: () => set({ shoppingModeShopId: null }),

  setSortMode: (listId, mode) =>
    set(state => {
      const sortModes = { ...state.sortModes, [listId]: mode }
      localStorage.setItem('sortModes', JSON.stringify(sortModes))
      return { sortModes }
    }),

  loadData: async () => {
    const [shops, tags, items, lists] = await Promise.all([
      apiClient.getShops(),
      apiClient.getTags(),
      apiClient.getItemsWithDetails(),
      apiClient.getLists(),
    ])
    const listItemsArr = await Promise.all(
      lists.map(l => apiClient.getListItemsWithItems(l.id))
    ).then(r => r.flat())
    set({ shops, tags, items, lists, listItems: listItemsArr })
  },

  addShop: async (input) => {
    const shop = await apiClient.createShop(input)
    set(state => ({ shops: [...state.shops, shop] }))
  },

  updateShop: async (id, patch) => {
    const updated = await apiClient.updateShop(id, patch)
    set(state => ({ shops: state.shops.map(s => s.id === id ? updated : s) }))
  },

  deleteShop: async (id) => {
    await apiClient.deleteShop(id)
    set(state => ({ shops: state.shops.filter(s => s.id !== id) }))
  },

  addTag: async (name) => {
    const tag = await apiClient.createTag(name)
    set(state => ({ tags: [...state.tags, tag] }))
  },

  upsertItem: async (item, shopIds, tagIds) => {
    await apiClient.upsertItem(item, shopIds, tagIds)
  },

  addItemToShop: async (itemId, shopId) => {
    await apiClient.addItemToShop(itemId, shopId)
  },

  removeItemFromShop: async (itemId, shopId) => {
    await apiClient.removeItemFromShop(itemId, shopId)
  },

  upsertList: async (list) => {
    const saved = await apiClient.upsertList(list)
    set(state => {
      const exists = state.lists.some(l => l.id === saved.id)
      if (exists) {
        return { lists: state.lists.map(l => l.id === saved.id ? saved : l) }
      }
      return { lists: [...state.lists, saved] }
    })
  },

  deleteList: async (id) => {
    await apiClient.deleteList(id)
    set(state => ({ lists: state.lists.filter(l => l.id !== id) }))
  },

  cloneList: async (id) => {
    const cloned = await apiClient.cloneList(id)
    set(state => ({ lists: [...state.lists, cloned] }))
  },

  upsertListItem: async (li) => {
    await apiClient.upsertListItem(li)
  },

  updateListItemState: async (id, state) => {
    await apiClient.updateListItemState(id, state)
  },

  skipShopForListItem: async (liId, shopId) => {
    await apiClient.skipShopForListItem(liId, shopId)
  },

  clearSkipForListItem: async (liId, shopId) => {
    await apiClient.clearSkipForListItem(liId, shopId)
  },

  createShoppingSession: async (listId, shopId) => {
    await apiClient.createShoppingSession(listId, shopId)
  },

  recordSessionItem: async (input) => {
    await apiClient.recordSessionItem(input)
  },
}))
