import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { apiClient } from '../api/client'
import type { AppEvent } from '../types/event'
import type { Item, List } from '../types'

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
  apiClient.reset()
  resetStore()
})

// Integration tests: run the store actions against the REAL ApiClient and assert
// the resulting client state, because the store actions are thin wrappers whose
// contract is "the entity the caller passed ends up persisted under the caller's id".

describe('useStore — integration with real ApiClient', () => {
  it('upsertItem with a new item persists it and its relations under the given item id', async () => {
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#ff0000' })
    const tag = await apiClient.createTag('dairy')

    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))

    const item: Item = {
      id: 'i-new',
      name: 'Milk',
      unit: 'l',
      defaultQuantity: 2,
      version: 1,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    await useStore.getState().upsertItem(item, [shop.id], [tag.id])
    unsubscribe()

    const enriched = await apiClient.getItemWithDetails('i-new')
    expect(enriched).toBeDefined()
    expect(enriched!.name).toBe('Milk')
    expect(enriched!.unit).toBe('l')
    expect(enriched!.shops.map(s => s.id)).toEqual([shop.id])
    expect(enriched!.tags.map(t => t.id)).toEqual([tag.id])

    const itemCreated = events.find(e => e.type === 'ItemCreated')
    expect(itemCreated?.entityId).toBe('i-new')

    const assignments = events.filter(e => e.type === 'ShopAssignedToItem' || e.type === 'TagAssignedToItem')
    expect(assignments).toHaveLength(2)
    for (const e of assignments) {
      expect(e.entityId).toBe('i-new')
    }
  })

  it('upsertList with a new list persists it under the given list id', async () => {
    const list: List = {
      id: 'l-new',
      name: 'Weekly',
      version: 1,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    await useStore.getState().upsertList(list)

    const saved = await apiClient.getList('l-new')
    expect(saved).toBeDefined()
    expect(saved!.name).toBe('Weekly')

    const inState = useStore.getState().lists
    expect(inState).toHaveLength(1)
    expect(inState[0]!.id).toBe('l-new')
  })
})
