import { describe, it, expect, beforeEach } from 'vitest'
import { apiClient } from './client'
import type { AppEvent } from '../types/event'
import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
} from '../types'

beforeEach(() => {
  apiClient.reset()
})

// ── Helpers ────────────────────────────────────────────────────────────────────

const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function expectEnvelope(e: AppEvent) {
  expect(typeof e.id).toBe('string')
  expect(e.id.length).toBeGreaterThan(0)
  expect(typeof e.clientId).toBe('string')
  expect(e.clientId.length).toBeGreaterThan(0)
  expect(Number.isInteger(e.lamport)).toBe(true)
  expect(e.lamport).toBeGreaterThan(0)
  expect(e.timestamp).toMatch(iso)
  expect(typeof e.entityId).toBe('string')
  expect(e.entityId.length).toBeGreaterThan(0)
  expect(e.payload).toBeDefined()
}

async function capture(fn: () => Promise<unknown>): Promise<AppEvent[]> {
  const events: AppEvent[] = []
  const unsubscribe = apiClient.subscribe(e => events.push(e))
  try {
    await fn()
  } finally {
    unsubscribe()
  }
  return events
}

// ── subscribe / reset / lamport ────────────────────────────────────────────────

describe('subscribe', () => {
  it('notifies listeners after each commit', async () => {
    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    await apiClient.createShop({ name: 'A', color: '#000' })
    await apiClient.createTag('t')
    expect(events).toHaveLength(2)
    expect(events.map(e => e.type)).toEqual(['ShopCreated', 'TagCreated'])
    unsubscribe()
  })

  it('delivers events to multiple listeners', async () => {
    const a: AppEvent[] = []
    const b: AppEvent[] = []
    const u1 = apiClient.subscribe(e => a.push(e))
    const u2 = apiClient.subscribe(e => b.push(e))
    await apiClient.createTag('dairy')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    u1()
    u2()
  })

  it('returns an unsubscribe function that stops delivery', async () => {
    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    await apiClient.createTag('a')
    unsubscribe()
    await apiClient.createTag('b')
    expect(events).toHaveLength(1)
  })
})

describe('reset', () => {
  it('clears the event log and resets the lamport counter to 0', async () => {
    await apiClient.createShop({ name: 'A', color: '#000' })
    const before = await capture(() => apiClient.createTag('x'))
    expect(before[0]!.lamport).toBe(2)
    apiClient.reset()
    const after = await capture(() => apiClient.createTag('y'))
    expect(after).toHaveLength(1)
    expect(after[0]!.lamport).toBe(1)
  })

  it('clears all Maps', async () => {
    const shop = await apiClient.createShop({ name: 'A', color: '#000' })
    await apiClient.createTag('t')
    const list = await apiClient.createList('L')
    const item = await apiClient.createItem({ name: 'M' }, [], [])
    await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })
    await apiClient.startShoppingSession(list.id, shop.id)
    expect(await apiClient.isEmpty()).toBe(false)

    apiClient.reset()

    expect(await apiClient.isEmpty()).toBe(true)
    expect(await apiClient.getShops()).toEqual([])
    expect(await apiClient.getTags()).toEqual([])
    expect(await apiClient.getLists()).toEqual([])
    expect(await apiClient.getItemsWithDetails()).toEqual([])
    expect(await apiClient.getListItemsWithItems(list.id)).toEqual([])
    expect(await apiClient.findOpenSession(list.id, shop.id)).toBeUndefined()
  })
})

describe('lamport ordering', () => {
  it('is strictly increasing across three different-method commits', async () => {
    const events = await capture(async () => {
      await apiClient.createShop({ name: 'A', color: '#000' })
      await apiClient.createTag('t')
      await apiClient.createList('L')
    })
    expect(events.map(e => e.type)).toEqual(['ShopCreated', 'TagCreated', 'ListCreated'])
    expect(events.map(e => e.lamport)).toEqual([1, 2, 3])
  })

  it('stamps the same clientId across commits', async () => {
    const events = await capture(async () => {
      const shop = await apiClient.createShop({ name: 'A', color: '#000' })
      await apiClient.renameShop(shop.id, 'B')
      await apiClient.createTag('t')
    })
    expect(events).toHaveLength(3)
    for (const e of events) expect(e.clientId).toBe(events[0]!.clientId)
  })
})

// ── Shops ──────────────────────────────────────────────────────────────────────

describe('shops', () => {
  it('getShops returns empty array initially', async () => {
    expect(await apiClient.getShops()).toEqual([])
  })

  it('createShop emits ShopCreated and returns the shop', async () => {
    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#ff0000' })
    unsubscribe()

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopCreated')
    expect(ev.entityId).toBe(shop.id)
    expect(ev.payload).toEqual({ name: 'Lidl', color: '#ff0000' })
    expect(ev.lamport).toBe(1)

    expect(shop.id).toBeDefined()
    expect(shop.name).toBe('Lidl')
    expect(shop.color).toBe('#ff0000')
    expect(shop.version).toBe(1)
    expect(shop.updatedAt).toMatch(iso)

    const shops = await apiClient.getShops()
    expect(shops).toEqual([expect.objectContaining({ id: shop.id, name: 'Lidl', color: '#ff0000', version: 1 })])
  })

  it('renameShop emits ShopRenamed and updates the projection', async () => {
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#ff0000' })
    let renamed!: Shop
    const events = await capture(async () => {
      renamed = await apiClient.renameShop(shop.id, 'Netto')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopRenamed')
    expect(ev.entityId).toBe(shop.id)
    expect(ev.payload).toEqual({ name: 'Netto' })

    expect(renamed.name).toBe('Netto')
    expect(renamed.version).toBe(2)
    expect(renamed.updatedAt).not.toBe(shop.updatedAt)

    const stored = await apiClient.getShop(shop.id)
    expect(stored?.name).toBe('Netto')
    expect(stored?.version).toBe(2)
  })

  it('changeShopColor emits ShopColorChanged and updates the projection', async () => {
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#ff0000' })
    let updated!: Shop
    const events = await capture(async () => {
      updated = await apiClient.changeShopColor(shop.id, '#00ff00')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopColorChanged')
    expect(ev.entityId).toBe(shop.id)
    expect(ev.payload).toEqual({ color: '#00ff00' })

    expect(updated.color).toBe('#00ff00')
    expect(updated.version).toBe(2)

    const stored = await apiClient.getShop(shop.id)
    expect(stored?.color).toBe('#00ff00')
    expect(stored?.version).toBe(2)
  })

  it('softDeleteShop emits ShopSoftDeleted and keeps the entity in the Map', async () => {
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#ff0000' })
    const events = await capture(() => apiClient.softDeleteShop(shop.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopSoftDeleted')
    expect(ev.entityId).toBe(shop.id)
    expect(ev.payload.deletedAt).toMatch(iso)

    const stored = await apiClient.getShop(shop.id)
    expect(stored?.deletedAt).toBe(ev.payload.deletedAt)
    const shops = await apiClient.getShops()
    expect(shops.some(s => s.id === shop.id)).toBe(true)
  })
})

// ── Tags ───────────────────────────────────────────────────────────────────────

describe('tags', () => {
  it('getTags returns empty array initially', async () => {
    expect(await apiClient.getTags()).toEqual([])
  })

  it('createTag emits TagCreated and returns the tag', async () => {
    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    const tag = await apiClient.createTag('dairy')
    unsubscribe()

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('TagCreated')
    expect(ev.entityId).toBe(tag.id)
    expect(ev.payload).toEqual({ name: 'dairy' })

    expect(tag.id).toBeDefined()
    expect(tag.name).toBe('dairy')
    expect(await apiClient.getTags()).toEqual([tag])
  })

  it('deleteTag emits TagDeleted and removes the tag', async () => {
    const tag = await apiClient.createTag('dairy')
    const events = await capture(() => apiClient.deleteTag(tag.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('TagDeleted')
    expect(ev.entityId).toBe(tag.id)
    expect(ev.payload).toEqual({})

    expect(await apiClient.getTags()).toEqual([])
  })
})

// ── Items ──────────────────────────────────────────────────────────────────────

describe('items', () => {
  it('getItemsWithDetails returns empty array initially', async () => {
    expect(await apiClient.getItemsWithDetails()).toEqual([])
  })

  it('createItem emits ItemCreated plus per-id relation events', async () => {
    const shop1 = await apiClient.createShop({ name: 'A', color: '#000' })
    const shop2 = await apiClient.createShop({ name: 'B', color: '#111' })
    const tag = await apiClient.createTag('dairy')

    let item!: Item
    const events = await capture(async () => {
      item = await apiClient.createItem(
        { name: 'Milk', unit: 'l', defaultQuantity: 2, description: 'desc', notes: 'note' },
        [shop1.id, shop2.id],
        [tag.id],
      )
    })

    expect(events).toHaveLength(4)
    const created = events[0]!
    expectEnvelope(created)
    expect(created.type).toBe('ItemCreated')
    expect(created.entityId).toBe(item.id)
    expect(created.payload).toEqual({ name: 'Milk', unit: 'l', defaultQuantity: 2, description: 'desc', notes: 'note' })

    const relations = events.slice(1)
    expect(relations).toHaveLength(3)
    for (const r of relations) {
      expectEnvelope(r)
      expect(r.entityId).toBe(item.id)
    }
    expect(relations.map(r => [r.type, r.payload])).toEqual(expect.arrayContaining([
      ['ShopAssignedToItem', { shopId: shop1.id }],
      ['ShopAssignedToItem', { shopId: shop2.id }],
      ['TagAssignedToItem', { tagId: tag.id }],
    ]))

    expect(item.id).toBeDefined()
    expect(item.name).toBe('Milk')
    expect(item.version).toBe(1)

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.shops.map(s => s.id).sort()).toEqual([shop1.id, shop2.id].sort())
    expect(details?.tags.map(t => t.id)).toEqual([tag.id])
  })

  it('updateItem emits ItemUpdated with only the changed fields', async () => {
    const item = await apiClient.createItem({ name: 'Milk', unit: 'l' }, [], [])
    let updated!: Item
    const events = await capture(async () => {
      updated = await apiClient.updateItem(item.id, { name: 'Skimmed Milk' })
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ItemUpdated')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toEqual({ name: 'Skimmed Milk' })

    expect(updated.name).toBe('Skimmed Milk')
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).not.toBe(item.updatedAt)

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.name).toBe('Skimmed Milk')
    expect(details?.unit).toBe('l')
    expect(details?.version).toBe(2)
  })

  it('updateItem with an explicit undefined clears the field', async () => {
    const item = await apiClient.createItem({ name: 'Flour', unit: 'kg' }, [], [])
    const events = await capture(() => apiClient.updateItem(item.id, { unit: undefined }))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.type).toBe('ItemUpdated')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toHaveProperty('unit')
    expect(ev.payload.unit).toBeUndefined()

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details).toBeDefined()
    expect('unit' in details!).toBe(true)
    expect(details?.unit).toBeUndefined()
  })

  it('assignShopToItem emits ShopAssignedToItem and updates the projection', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#f00' })
    const events = await capture(() => apiClient.assignShopToItem(item.id, shop.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopAssignedToItem')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toEqual({ shopId: shop.id })

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.shops.map(s => s.id)).toEqual([shop.id])
  })

  it('removeShopFromItem emits ShopRemovedFromItem and updates the projection', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, ['s1'], [])
    const events = await capture(() => apiClient.removeShopFromItem(item.id, 's1'))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopRemovedFromItem')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toEqual({ shopId: 's1' })

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.shops).toEqual([])
  })

  it('assignTagToItem emits TagAssignedToItem and updates the projection', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const tag = await apiClient.createTag('dairy')
    const events = await capture(() => apiClient.assignTagToItem(item.id, tag.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('TagAssignedToItem')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toEqual({ tagId: tag.id })

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.tags.map(t => t.id)).toEqual([tag.id])
  })

  it('removeTagFromItem emits TagRemovedFromItem and updates the projection', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, [], ['t1'])
    const events = await capture(() => apiClient.removeTagFromItem(item.id, 't1'))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('TagRemovedFromItem')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload).toEqual({ tagId: 't1' })

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.tags).toEqual([])
  })

  it('saveItemShopsAndTags emits only per-diff relation events', async () => {
    const s1 = await apiClient.createShop({ name: 'A', color: '#000' })
    const s2 = await apiClient.createShop({ name: 'B', color: '#111' })
    const s3 = await apiClient.createShop({ name: 'C', color: '#222' })
    const t1 = await apiClient.createTag('dairy')
    const t2 = await apiClient.createTag('frozen')
    const item = await apiClient.createItem({ name: 'Milk' }, [s1.id, s2.id], [t1.id])

    const events = await capture(() =>
      apiClient.saveItemShopsAndTags(item.id, [s2.id, s3.id], [t2.id])
    )

    expect(events).toHaveLength(4)
    for (const ev of events) {
      expectEnvelope(ev)
      expect(ev.entityId).toBe(item.id)
    }
    expect(events.map(e => [e.type, e.payload])).toEqual(expect.arrayContaining([
      ['ShopRemovedFromItem', { shopId: s1.id }],
      ['ShopAssignedToItem', { shopId: s3.id }],
      ['TagRemovedFromItem', { tagId: t1.id }],
      ['TagAssignedToItem', { tagId: t2.id }],
    ]))
    expect(events.filter(e => e.type === 'ShopAssignedToItem' && e.payload.shopId === s2.id)).toHaveLength(0)
    expect(events.filter(e => e.type === 'ShopRemovedFromItem' && e.payload.shopId === s2.id)).toHaveLength(0)

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.shops.map(s => s.id).sort()).toEqual([s2.id, s3.id].sort())
    expect(details?.tags.map(t => t.id)).toEqual([t2.id])
  })

  it('softDeleteItem emits ItemSoftDeleted and hides the item from reads', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const events = await capture(() => apiClient.softDeleteItem(item.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ItemSoftDeleted')
    expect(ev.entityId).toBe(item.id)
    expect(ev.payload.deletedAt).toMatch(iso)

    const details = await apiClient.getItemWithDetails(item.id)
    expect(details?.deletedAt).toBe(ev.payload.deletedAt)
    expect(await apiClient.getItemsWithDetails()).toEqual([])
  })

  it('bumps version and updatedAt on each item mutation', async () => {
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    expect(item.version).toBe(1)
    const updated = await apiClient.updateItem(item.id, { name: 'Milk 2' })
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).not.toBe(item.updatedAt)
  })
})

// ── Lists ──────────────────────────────────────────────────────────────────────

describe('lists', () => {
  it('getLists returns empty array initially', async () => {
    expect(await apiClient.getLists()).toEqual([])
  })

  it('createList emits ListCreated and returns the list', async () => {
    let list!: List
    const events = await capture(async () => {
      list = await apiClient.createList('Weekly')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListCreated')
    expect(ev.entityId).toBe(list.id)
    expect(ev.payload).toEqual({ name: 'Weekly' })

    expect(list.id).toBeDefined()
    expect(list.name).toBe('Weekly')
    expect(list.version).toBe(1)
    expect((await apiClient.getLists())[0]).toEqual(expect.objectContaining({ id: list.id, name: 'Weekly' }))
  })

  it('renameList emits ListRenamed and updates the projection', async () => {
    const list = await apiClient.createList('Weekly')
    let renamed!: List
    const events = await capture(async () => {
      renamed = await apiClient.renameList(list.id, 'Monthly')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListRenamed')
    expect(ev.entityId).toBe(list.id)
    expect(ev.payload).toEqual({ name: 'Monthly' })

    expect(renamed.name).toBe('Monthly')
    expect(renamed.version).toBe(2)
    expect((await apiClient.getList(list.id))?.name).toBe('Monthly')
  })

  it('archiveList emits ListArchived and updates the projection', async () => {
    const list = await apiClient.createList('Weekly')
    let archived!: List
    const events = await capture(async () => {
      archived = await apiClient.archiveList(list.id)
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListArchived')
    expect(ev.entityId).toBe(list.id)
    expect(ev.payload.archivedAt).toMatch(iso)

    expect(archived.archivedAt).toBe(ev.payload.archivedAt)
    expect((await apiClient.getList(list.id))?.archivedAt).toBe(ev.payload.archivedAt)
  })

  it('unarchiveList emits ListUnarchived and clears archivedAt in the projection', async () => {
    const list = await apiClient.createList('Weekly')
    await apiClient.archiveList(list.id)
    let unarchived!: List
    const events = await capture(async () => {
      unarchived = await apiClient.unarchiveList(list.id)
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListUnarchived')
    expect(ev.entityId).toBe(list.id)
    expect(ev.payload).toEqual({})

    expect(unarchived.archivedAt).toBeUndefined()
    expect((await apiClient.getList(list.id))?.archivedAt).toBeUndefined()
  })

  it('deleteList emits ListDeleted and keeps the entity in the Map', async () => {
    const list = await apiClient.createList('Weekly')
    const events = await capture(() => apiClient.deleteList(list.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListDeleted')
    expect(ev.entityId).toBe(list.id)
    expect(ev.payload.deletedAt).toMatch(iso)

    expect((await apiClient.getList(list.id))?.deletedAt).toBe(ev.payload.deletedAt)
    expect((await apiClient.getLists()).some(l => l.id === list.id)).toBe(true)
  })

  it('cloneList emits ListCreated first, then one ListItemAdded per source item', async () => {
    let src!: List
    let i1!: Item
    let i2!: Item
    const setupEvents = await capture(async () => {
      src = await apiClient.createList('Weekly')
      i1 = await apiClient.createItem({ name: 'Milk', unit: 'l' }, [], [])
      i2 = await apiClient.createItem({ name: 'Eggs' }, [], [])
      await apiClient.addListItem({ listId: src.id, itemId: i1.id, state: 'active', quantity: 2, unit: 'l', notes: 'buy two' })
      await apiClient.addListItem({ listId: src.id, itemId: i2.id, state: 'bought', quantity: 1 })
    })

    let cloned!: List
    const events = await capture(async () => {
      cloned = await apiClient.cloneList(src.id)
    })

    expect(events).toHaveLength(3)
    const created = events[0]!
    expectEnvelope(created)
    expect(created.type).toBe('ListCreated')
    expect(created.entityId).toBe(cloned.id)
    expect(created.payload).toEqual({ name: 'Copy of Weekly' })
    expect(cloned.name).toBe('Copy of Weekly')

    const clonedLis = await apiClient.getListItemsWithItems(cloned.id)
    expect(clonedLis).toHaveLength(2)

    const liEvents = events.slice(1)
    expect(liEvents.map(e => e.type)).toEqual(['ListItemAdded', 'ListItemAdded'])
    for (const ev of liEvents) {
      expectEnvelope(ev)
      expect(ev.entityId).not.toBe('')
    }
    expect(liEvents.map(e => e.entityId).sort()).toEqual(clonedLis.map(li => li.id).sort())

    expect(liEvents.map(e => [e.type, e.payload])).toEqual(expect.arrayContaining([
      ['ListItemAdded', { listId: cloned.id, itemId: i1.id, state: 'active', quantity: 2, unit: 'l', notes: 'buy two' }],
      ['ListItemAdded', { listId: cloned.id, itemId: i2.id, state: 'bought', quantity: 1 }],
    ]))

    const milk = clonedLis.find(li => li.itemId === i1.id)
    const eggs = clonedLis.find(li => li.itemId === i2.id)
    expect(milk).toBeDefined()
    expect(milk?.state).toBe('active')
    expect(milk?.quantity).toBe(2)
    expect(milk?.unit).toBe('l')
    expect(milk?.notes).toBe('buy two')
    expect(eggs).toBeDefined()
    expect(eggs?.state).toBe('bought')
    expect(eggs?.quantity).toBe(1)

    const lamports = events.map(e => e.lamport)
    expect(lamports).toEqual([...lamports].sort((a, b) => a - b))
    const lastSetupLamport = setupEvents.at(-1)!.lamport
    expect(lamports).toEqual([lastSetupLamport + 1, lastSetupLamport + 2, lastSetupLamport + 3])
  })
})

// ── ListItems ──────────────────────────────────────────────────────────────────

describe('listItems', () => {
  it('addListItem emits ListItemAdded and returns a listItem with a generated id', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])

    let li!: ListItem
    const events = await capture(async () => {
      li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active', quantity: 2, unit: 'l', notes: 'note' })
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListItemAdded')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({ listId: list.id, itemId: item.id, state: 'active', quantity: 2, unit: 'l', notes: 'note' })

    expect(li.id).toBeDefined()
    expect(li.listId).toBe(list.id)
    expect(li.itemId).toBe(item.id)
    expect(li.state).toBe('active')
    expect(li.version).toBe(1)

    const lis = await apiClient.getListItemsWithItems(list.id)
    expect(lis).toHaveLength(1)
    expect(lis[0]!.id).toBe(li.id)
    expect(lis[0]!.quantity).toBe(2)
    expect(lis[0]!.unit).toBe('l')
    expect(lis[0]!.notes).toBe('note')
  })

  it('setListItemState emits ListItemStateChanged and updates the projection', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })

    let updated!: ListItem
    const events = await capture(async () => {
      updated = await apiClient.setListItemState(li.id, 'bought')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListItemStateChanged')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({ state: 'bought' })

    expect(updated.state).toBe('bought')
    expect((await apiClient.getListItemsWithItems(list.id))[0]!.state).toBe('bought')
  })

  it('changeListItemQuantity emits ListItemQuantityChanged and updates the projection', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Flour' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active', quantity: 1, unit: 'kg' })

    let updated!: ListItem
    const events = await capture(async () => {
      updated = await apiClient.changeListItemQuantity(li.id, 3, 'kg')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListItemQuantityChanged')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({ quantity: 3, unit: 'kg' })

    expect(updated.quantity).toBe(3)
    expect(updated.unit).toBe('kg')
    const stored = (await apiClient.getListItemsWithItems(list.id))[0]!
    expect(stored.quantity).toBe(3)
    expect(stored.unit).toBe('kg')
  })

  it('removeListItem emits ListItemRemoved and removes it from the projection', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })

    const events = await capture(() => apiClient.removeListItem(li.id))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ListItemRemoved')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({})

    expect(await apiClient.getListItemsWithItems(list.id)).toEqual([])
  })

  it('skipShopForListItem emits ShopSkippedForListItem and records the skip', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })

    const events = await capture(() => apiClient.skipShopForListItem(li.id, 's1'))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopSkippedForListItem')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({ shopId: 's1' })

    const lis = await apiClient.getListItemsWithItems(list.id)
    expect(lis[0]!.skippedShopIds).toEqual(['s1'])
  })

  it('clearSkipForListItem emits ShopSkipCleared and removes the skip', async () => {
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })
    await apiClient.skipShopForListItem(li.id, 's1')

    const events = await capture(() => apiClient.clearSkipForListItem(li.id, 's1'))

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShopSkipCleared')
    expect(ev.entityId).toBe(li.id)
    expect(ev.payload).toEqual({ shopId: 's1' })

    const lis = await apiClient.getListItemsWithItems(list.id)
    expect(lis[0]!.skippedShopIds).toEqual([])
  })
})

// ── Sessions ───────────────────────────────────────────────────────────────────

describe('sessions', () => {
  it('startShoppingSession emits ShoppingSessionStarted and stores the session', async () => {
    let session!: ShoppingSession
    const events = await capture(async () => {
      session = await apiClient.startShoppingSession('l1', 's1')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('ShoppingSessionStarted')
    expect(ev.entityId).toBe(session.id)
    expect(ev.payload).toEqual({ listId: 'l1', shopId: 's1' })

    expect(session.id).toBeDefined()
    expect(session.listId).toBe('l1')
    expect(session.shopId).toBe('s1')
    expect(session.version).toBe(1)
    expect((await apiClient.findOpenSession('l1', 's1'))?.id).toBe(session.id)
  })

  it('recordSessionItem with action bought emits SessionItemBought', async () => {
    const session = await apiClient.startShoppingSession('l1', 's1')
    let si!: SessionItem
    const events = await capture(async () => {
      si = await apiClient.recordSessionItem({
        sessionId: session.id,
        itemId: 'i1',
        action: 'bought',
        at: '2024-01-01T10:00:00.000Z',
        quantity: 2,
        unit: 'l',
      })
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('SessionItemBought')
    expect(ev.entityId).toBe(session.id)
    expect(ev.payload).toEqual({ itemId: 'i1', quantity: 2, unit: 'l' })

    expect(si.id).toBeDefined()
    expect(si.action).toBe('bought')
    expect(si.at).toBe('2024-01-01T10:00:00.000Z')
    const stored = await apiClient.getSessionItems(session.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.id).toBe(si.id)
  })

  it('recordSessionItem with action skipped emits SessionItemSkipped', async () => {
    const session = await apiClient.startShoppingSession('l1', 's1')
    let si!: SessionItem
    const events = await capture(async () => {
      si = await apiClient.recordSessionItem({
        sessionId: session.id,
        itemId: 'i1',
        action: 'skipped',
        at: '2024-01-01T10:00:00.000Z',
      })
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('SessionItemSkipped')
    expect(ev.entityId).toBe(session.id)
    expect(ev.payload).toEqual({ itemId: 'i1' })

    expect(si.action).toBe('skipped')
  })

  it('enriches items with frequency from bought session items', async () => {
    const shop = await apiClient.createShop({ name: 'Lidl', color: '#f00' })
    const item = await apiClient.createItem({ name: 'Milk' }, [shop.id], [])
    const session = await apiClient.startShoppingSession('list-1', shop.id)
    await apiClient.recordSessionItem({ sessionId: session.id, itemId: item.id, action: 'bought', at: '2024-01-01T10:00:00.000Z' })
    await apiClient.recordSessionItem({ sessionId: session.id, itemId: item.id, action: 'bought', at: '2024-01-02T10:00:00.000Z' })

    const items = await apiClient.getItemsWithDetails()
    expect(items[0]!.frequency).toBe(2)
    expect(items[0]!.lastBoughtAt).toBe('2024-01-02T10:00:00.000Z')
    expect(items[0]!.lastBoughtShopId).toBe(shop.id)
  })
})

// ── Bug reports ────────────────────────────────────────────────────────────────

describe('bug reports', () => {
  it('reportBug emits BugReported with the text and a report id as entityId', async () => {
    let reportId!: string
    const events = await capture(async () => {
      reportId = await apiClient.reportBug('App crashed on list view')
    })

    expect(events).toHaveLength(1)
    const ev = events[0]!
    expectEnvelope(ev)
    expect(ev.type).toBe('BugReported')
    expect(ev.entityId).toBe(reportId)
    expect(ev.payload).toEqual({ text: 'App crashed on list view' })
  })

  it('reportBug advances the lamport clock like any other event', async () => {
    await apiClient.createShop({ name: 'Lidl', color: '#f00' })
    const events = await capture(() => apiClient.reportBug('another bug'))
    expect(events[0]!.lamport).toBe(2)
  })
})
