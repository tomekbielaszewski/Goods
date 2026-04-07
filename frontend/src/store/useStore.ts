import { create } from 'zustand'
import type { Conflict, SortMode, SyncStatus } from '../types'

interface AppStore {
  // sync
  syncStatus: SyncStatus
  conflicts: Conflict[]
  lastSyncedAt: string | null

  // ui navigation state
  shoppingModeShopId: string | null   // null = browse mode

  // sort preference persisted per-list
  sortModes: Record<string, SortMode>

  // actions
  setSyncStatus: (s: SyncStatus) => void
  setLastSyncedAt: (t: string) => void
  addConflicts: (c: Conflict[]) => void
  resolveConflict: (entity: string, id: string) => void
  enterShoppingMode: (shopId: string) => void
  exitShoppingMode: () => void
  setSortMode: (listId: string, mode: SortMode) => void
}

export const useStore = create<AppStore>((set) => ({
  syncStatus: 'idle',
  conflicts: [],
  lastSyncedAt: localStorage.getItem('lastSyncedAt'),
  shoppingModeShopId: null,
  sortModes: {},

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setLastSyncedAt: (t) => {
    localStorage.setItem('lastSyncedAt', t)
    set({ lastSyncedAt: t })
  },

  addConflicts: (incoming) =>
    set(state => ({ conflicts: [...state.conflicts, ...incoming] })),

  resolveConflict: (entity, id) =>
    set(state => ({
      conflicts: state.conflicts.filter(c => !(c.entity === entity && c.id === id)),
    })),

  enterShoppingMode: (shopId) => set({ shoppingModeShopId: shopId }),
  exitShoppingMode: () => set({ shoppingModeShopId: null }),

  setSortMode: (listId, mode) =>
    set(state => ({ sortModes: { ...state.sortModes, [listId]: mode } })),
}))
