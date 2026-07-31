import { describe, it, expect, beforeEach } from 'vitest'
import { apiClient } from './client'
import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemWithDetails, ListItemWithItem,
} from '../types'

beforeEach(() => {
  apiClient.reset()
})

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeShop = (id: string, color = '#ff0000'): Omit<Shop, 'id' | 'version' | 'updatedAt'> => ({
  name: `Shop ${id}`,
  color,
})

const makeItem = (id: string, name: string): Omit<Item, 'id' | 'version' | 'createdAt' | 'updatedAt'> => ({
  name,
})

const makeList = (id: string, overrides: Partial<List> = {}): List => ({
  id,
  name: `List ${id}`,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeListItem = (id: string, listId: string, itemId: string, state: 'active' | 'bought' = 'active'): ListItem => ({
  id,
  listId,
  itemId,
  state,
  version: 1,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

// ── isEmpty ────────────────────────────────────────────────────────────────────

describe('isEmpty', () => {
  it('returns true on empty state', async () => {
    expect(await apiClient.isEmpty()).toBe(true)
  })

  it('returns false after adding an item', async () => {
    const shop = await apiClient.createShop(makeShop('shop-1'))
    await apiClient.upsertItem(
      { ...makeItem('item-1', 'Milk'), id: 'item-1', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop.id],
      [],
    )
    expect(await apiClient.isEmpty()).toBe(false)
  })
})

// ── Shops ──────────────────────────────────────────────────────────────────────

describe('shops', () => {
  it('getShops returns empty array initially', async () => {
    expect(await apiClient.getShops()).toEqual([])
  })

  it('createShop returns a shop with id, version, updatedAt', async () => {
    const shop = await apiClient.createShop(makeShop('s1'))
    expect(shop.id).toBeDefined()
    expect(shop.name).toBe('Shop s1')
    expect(shop.color).toBe('#ff0000')
    expect(shop.version).toBe(1)
    expect(shop.updatedAt).toBeDefined()
  })

  it('getShops returns all created shops', async () => {
    await apiClient.createShop(makeShop('s1'))
    await apiClient.createShop(makeShop('s2'))
    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(2)
  })

  it('updateShop updates fields and returns updated shop', async () => {
    const shop = await apiClient.createShop(makeShop('s1'))
    const updated = await apiClient.updateShop(shop.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
    expect(updated.id).toBe(shop.id)
    expect(updated.version).toBe(2)
  })

  it('deleteShop removes the shop', async () => {
    const shop = await apiClient.createShop(makeShop('s1'))
    await apiClient.deleteShop(shop.id)
    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(0)
  })
})

// ── Tags ───────────────────────────────────────────────────────────────────────

describe('tags', () => {
  it('getTags returns empty array initially', async () => {
    expect(await apiClient.getTags()).toEqual([])
  })

  it('createTag returns a tag with id and name', async () => {
    const tag = await apiClient.createTag('dairy')
    expect(tag.id).toBeDefined()
    expect(tag.name).toBe('dairy')
  })

  it('getTags returns all created tags', async () => {
    await apiClient.createTag('dairy')
    await apiClient.createTag('produce')
    const tags = await apiClient.getTags()
    expect(tags).toHaveLength(2)
  })

  it('deleteTag removes the tag', async () => {
    const tag = await apiClient.createTag('dairy')
    await apiClient.deleteTag(tag.id)
    const tags = await apiClient.getTags()
    expect(tags).toHaveLength(0)
  })
})

// ── Items ──────────────────────────────────────────────────────────────────────

describe('items', () => {
  it('getItemsWithDetails returns empty array initially', async () => {
    expect(await apiClient.getItemsWithDetails()).toEqual([])
  })

  it('upsertItem creates a new item with shops and tags', async () => {
    const shop = await apiClient.createShop(makeShop('shop-1'))
    const tag = await apiClient.createTag('dairy')
    const item = await apiClient.upsertItem(
      { ...makeItem('i1', 'Milk'), id: 'i1', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop.id],
      [tag.id],
    )
    expect(item.id).toBe('i1')
    expect(item.name).toBe('Milk')

    const items = await apiClient.getItemsWithDetails()
    expect(items).toHaveLength(1)
    expect(items[0]!.shops).toHaveLength(1)
    expect(items[0]!.shops[0]!.id).toBe(shop.id)
    expect(items[0]!.tags).toHaveLength(1)
    expect(items[0]!.tags[0]!.id).toBe(tag.id)
  })

  it('upsertItem updates existing item and replaces shops', async () => {
    const shop1 = await apiClient.createShop(makeShop('shop-1'))
    const shop2 = await apiClient.createShop(makeShop('shop-2'))

    const item = { id: 'i1', name: 'Whole Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item
    await apiClient.upsertItem(item, [shop1.id], [])

    const updated = { ...item, name: 'Skimmed Milk', updatedAt: new Date().toISOString() } as Item
    await apiClient.upsertItem(updated, [shop2.id], [])

    const items = await apiClient.getItemsWithDetails()
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Skimmed Milk')
    expect(items[0]!.shops).toHaveLength(1)
    expect(items[0]!.shops[0]!.id).toBe(shop2.id)
  })

  it('getItemsWithDetails excludes deleted items', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Active', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Deleted', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const items = await apiClient.getItemsWithDetails()
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Active')
  })

  it('getItemsWithDetails returns empty shops/tags when item has none', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const items = await apiClient.getItemsWithDetails()
    expect(items[0]!.shops).toEqual([])
    expect(items[0]!.tags).toEqual([])
    expect(items[0]!.frequency).toBe(0)
  })

  it('getItemWithDetails returns single item', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const item = await apiClient.getItemWithDetails('i1')
    expect(item).toBeDefined()
    expect(item!.name).toBe('Milk')
  })

  it('getItemWithDetails returns undefined for missing item', async () => {
    const item = await apiClient.getItemWithDetails('no-such-id')
    expect(item).toBeUndefined()
  })

  it('addItemToShop and removeItemFromShop', async () => {
    const shop1 = await apiClient.createShop(makeShop('shop-1'))
    const shop2 = await apiClient.createShop(makeShop('shop-2'))

    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop1.id], [],
    )

    await apiClient.addItemToShop('i1', shop2.id)
    let items = await apiClient.getItemsWithDetails()
    expect(items[0]!.shops).toHaveLength(2)

    await apiClient.removeItemFromShop('i1', shop1.id)
    items = await apiClient.getItemsWithDetails()
    expect(items[0]!.shops).toHaveLength(1)
    expect(items[0]!.shops[0]!.id).toBe(shop2.id)
  })

  it('getItemsForShop returns items assigned to that shop', async () => {
    const shop = await apiClient.createShop(makeShop('shop-1'))
    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop.id], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )

    const items = await apiClient.getItemsForShop(shop.id)
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Milk')
  })

  it('enrichment includes frequency, lastBoughtAt, lastBoughtShopId from session items', async () => {
    const shop = await apiClient.createShop(makeShop('shop-1'))
    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop.id], [],
    )

    const session = await apiClient.createShoppingSession('list-1', shop.id)
    await apiClient.recordSessionItem({
      sessionId: session.id,
      itemId: 'i1',
      action: 'bought',
      at: '2024-01-01T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id,
      itemId: 'i1',
      action: 'bought',
      at: '2024-01-02T10:00:00.000Z',
    })

    const items = await apiClient.getItemsWithDetails()
    expect(items[0]!.frequency).toBe(2)
    expect(items[0]!.lastBoughtAt).toBe('2024-01-02T10:00:00.000Z')
    expect(items[0]!.lastBoughtShopId).toBe(shop.id)
  })
})

// ── Search filtering ───────────────────────────────────────────────────────────

describe('search filtering', () => {
  beforeEach(async () => {
    apiClient.reset()
    await apiClient.upsertItem(
      { id: 'i1', name: 'Whole Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Oat Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i3', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
  })

  it('returns matching items only', async () => {
    const result = await apiClient.getItemsWithDetails('milk')
    expect(result).toHaveLength(2)
    expect(result.map(i => i.name).sort()).toEqual(['Oat Milk', 'Whole Milk'])
  })

  it('is case-insensitive', async () => {
    apiClient.reset()
    await apiClient.upsertItem(
      { id: 'i1', name: 'Whole Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'BUTTER', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const result = await apiClient.getItemsWithDetails('MILK')
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Whole Milk')
  })

  it('returns empty when no match', async () => {
    const result = await apiClient.getItemsWithDetails('xyz')
    expect(result).toEqual([])
  })

  it('matches Polish diacritics with plain ASCII', async () => {
    apiClient.reset()
    await apiClient.upsertItem(
      { id: 'i1', name: 'Jabłka', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Żółw', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i3', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )

    const result1 = await apiClient.getItemsWithDetails('jabl')
    expect(result1).toHaveLength(1)
    expect(result1[0]!.name).toBe('Jabłka')

    const result2 = await apiClient.getItemsWithDetails('zolw')
    expect(result2).toHaveLength(1)
    expect(result2[0]!.name).toBe('Żółw')
  })

  it('matches when search term has diacritics and name does not', async () => {
    apiClient.reset()
    await apiClient.upsertItem(
      { id: 'i1', name: 'Jablka', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const result = await apiClient.getItemsWithDetails('jabłka')
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Jablka')
  })

  it('matches when search term has trailing or leading whitespace', async () => {
    apiClient.reset()
    await apiClient.upsertItem(
      { id: 'i1', name: 'szczypiorek', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    const resultTrailing = await apiClient.getItemsWithDetails('szczypiorek ')
    expect(resultTrailing).toHaveLength(1)

    const resultLeading = await apiClient.getItemsWithDetails(' szczypiorek')
    expect(resultLeading).toHaveLength(1)
  })
})

// ── getFrequentItems ───────────────────────────────────────────────────────────

describe('getFrequentItems', () => {
  it('excludes active items on given list', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'i1', 'active'))

    const result = await apiClient.getFrequentItems('list-1')
    const ids = result.map(i => i.id)
    expect(ids).not.toContain('i1')
    expect(ids).toContain('i2')
  })

  it('includes bought items on list', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Eggs', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'i1', 'bought'))

    const result = await apiClient.getFrequentItems('list-1')
    const ids = result.map(i => i.id)
    expect(ids).toContain('i1')
  })

  it('sorts by frequency descending', async () => {
    await apiClient.upsertItem(
      { id: 'i1', name: 'Rare', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i2', name: 'Common', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertItem(
      { id: 'i3', name: 'Most Common', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )

    const shop = await apiClient.createShop(makeShop('shop-1'))
    const session = await apiClient.createShoppingSession('list-x', shop.id)

    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i3', action: 'bought', at: '2024-01-01T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i3', action: 'bought', at: '2024-01-02T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i3', action: 'bought', at: '2024-01-03T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i2', action: 'bought', at: '2024-01-01T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i2', action: 'bought', at: '2024-01-02T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id, itemId: 'i1', action: 'bought', at: '2024-01-01T10:00:00.000Z',
    })

    const result = await apiClient.getFrequentItems('list-x')
    expect(result[0]!.id).toBe('i3')
    expect(result[1]!.id).toBe('i2')
    expect(result[2]!.id).toBe('i1')
    expect(result[0]!.frequency).toBe(3)
    expect(result[1]!.frequency).toBe(2)
    expect(result[2]!.frequency).toBe(1)
  })

  it('returns all catalogue items not active on list', async () => {
    const manyItems = Array.from({ length: 25 }, (_, i) =>
      ({ id: `i${i + 1}`, name: `Item ${i + 1}`, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item),
    )
    for (const item of manyItems) {
      await apiClient.upsertItem(item, [], [])
    }

    const result = await apiClient.getFrequentItems('list-1')
    expect(result.length).toBe(25)
  })
})

// ── Lists ──────────────────────────────────────────────────────────────────────

describe('lists', () => {
  it('getLists returns empty array initially', async () => {
    expect(await apiClient.getLists()).toEqual([])
  })

  it('upsertList creates a new list', async () => {
    const list = makeList('list-1')
    const saved = await apiClient.upsertList(list)
    expect(saved.id).toBe('list-1')
    expect(saved.name).toBe('List list-1')

    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
  })

  it('upsertList updates existing list', async () => {
    const list = makeList('list-1')
    await apiClient.upsertList(list)

    const updated = { ...list, name: 'Renamed', version: 2 }
    await apiClient.upsertList(updated)

    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Renamed')
  })

  it('deleteList removes a list', async () => {
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.deleteList('list-1')
    expect(await apiClient.getLists()).toHaveLength(0)
  })

  it('cloneList creates a copy with new IDs', async () => {
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))
    await apiClient.upsertListItem(makeListItem('li-2', 'list-1', 'item-2'))

    const cloned = await apiClient.cloneList('list-1')
    expect(cloned.id).not.toBe('list-1')
    expect(cloned.name).toBe('Copy of List list-1')

    const allLists = await apiClient.getLists()
    expect(allLists).toHaveLength(2)

    const clonedItems = await apiClient.getListItemsWithItems(cloned.id)
    expect(clonedItems).toHaveLength(2)
    expect(clonedItems.every(li => li.id !== 'li-1' && li.id !== 'li-2')).toBe(true)
  })
})

// ── ListItems ──────────────────────────────────────────────────────────────────

describe('listItems', () => {
  it('getListItemsWithItems returns enriched items', async () => {
    const shop = await apiClient.createShop(makeShop('shop-1'))
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [shop.id], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result).toHaveLength(1)
    expect(result[0]!.item.name).toBe('Milk')
    expect(result[0]!.item.shops).toHaveLength(1)
  })

  it('getListItemsWithItems includes skippedShopIds', async () => {
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    await apiClient.skipShopForListItem('li-1', 'shop-1')
    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result[0]!.skippedShopIds).toEqual(['shop-1'])
  })

  it('upsertListItem creates and updates', async () => {
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))

    const li = makeListItem('li-1', 'list-1', 'item-1')
    const saved = await apiClient.upsertListItem(li)
    expect(saved.id).toBe('li-1')

    const updated = await apiClient.upsertListItem({ ...li, quantity: 3 })
    expect(updated.quantity).toBe(3)
  })

  it('updateListItemState changes state', async () => {
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1', 'active'))

    const updated = await apiClient.updateListItemState('li-1', 'bought')
    expect(updated.state).toBe('bought')
  })
})

// ── skipShopForListItem / clearSkipForListItem ─────────────────────────────────

describe('skipShopForListItem', () => {
  it('skipShopForListItem adds a skip', async () => {
    await apiClient.skipShopForListItem('li-1', 'shop-1')
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result[0]!.skippedShopIds).toContain('shop-1')
  })

  it('is idempotent', async () => {
    await apiClient.skipShopForListItem('li-1', 'shop-1')
    await apiClient.skipShopForListItem('li-1', 'shop-1')
    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result[0]!.skippedShopIds.filter(id => id === 'shop-1')).toHaveLength(1)
  })
})

describe('clearSkipForListItem', () => {
  it('removes a skip', async () => {
    await apiClient.skipShopForListItem('li-1', 'shop-1')
    await apiClient.clearSkipForListItem('li-1', 'shop-1')

    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result[0]!.skippedShopIds).toEqual([])
  })

  it('only removes targeted shop', async () => {
    await apiClient.skipShopForListItem('li-1', 'shop-1')
    await apiClient.skipShopForListItem('li-1', 'shop-2')
    await apiClient.clearSkipForListItem('li-1', 'shop-1')

    await apiClient.upsertItem(
      { id: 'item-1', name: 'Milk', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Item,
      [], [],
    )
    await apiClient.upsertList(makeList('list-1'))
    await apiClient.upsertListItem(makeListItem('li-1', 'list-1', 'item-1'))

    const result = await apiClient.getListItemsWithItems('list-1')
    expect(result[0]!.skippedShopIds).toEqual(['shop-2'])
  })

  it('no-op when skip does not exist', async () => {
    await expect(apiClient.clearSkipForListItem('no-li', 'no-shop')).resolves.not.toThrow()
  })
})

// ── Sessions ───────────────────────────────────────────────────────────────────

describe('sessions', () => {
  it('createShoppingSession creates a session', async () => {
    const session = await apiClient.createShoppingSession('list-1', 'shop-1')
    expect(session.id).toBeDefined()
    expect(session.listId).toBe('list-1')
    expect(session.shopId).toBe('shop-1')
  })

  it('recordSessionItem records an item in a session', async () => {
    const session = await apiClient.createShoppingSession('list-1', 'shop-1')
    const si = await apiClient.recordSessionItem({
      sessionId: session.id,
      itemId: 'item-1',
      action: 'bought',
      at: new Date().toISOString(),
    })
    expect(si.id).toBeDefined()
    expect(si.action).toBe('bought')
  })

  it('getSessionItems returns items for a session', async () => {
    const session = await apiClient.createShoppingSession('list-1', 'shop-1')
    await apiClient.recordSessionItem({
      sessionId: session.id,
      itemId: 'item-1',
      action: 'bought',
      at: '2024-01-01T10:00:00.000Z',
    })
    await apiClient.recordSessionItem({
      sessionId: session.id,
      itemId: 'item-2',
      action: 'skipped',
      at: '2024-01-01T10:01:00.000Z',
    })

    const items = await apiClient.getSessionItems(session.id)
    expect(items).toHaveLength(2)
  })
})
