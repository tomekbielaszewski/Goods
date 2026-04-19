import { create } from 'zustand'
import type { Conflict, SortMode, SyncStatus } from '../types'

interface AppStore {
  // sync
  syncStatus: SyncStatus
  syncFailed: boolean      // true if last completed sync failed; clears on success
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
  syncFailed: false,
  conflicts: [],
  lastSyncedAt: localStorage.getItem('lastSyncedAt'),
  shoppingModeShopId: null,
  sortModes: JSON.parse(localStorage.getItem('sortModes') ?? '{}') as Record<string, SortMode>,

  setSyncStatus: (syncStatus) => set(state => ({
    syncStatus,
    syncFailed:
      syncStatus === 'error' || syncStatus === 'offline' ? true :
      syncStatus === 'synced'                            ? false :
      state.syncFailed,
  })),

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
    set(state => {
      const sortModes = { ...state.sortModes, [listId]: mode }
      localStorage.setItem('sortModes', JSON.stringify(sortModes))
      return { sortModes }
    }),
}))
