import { describe, it, expect } from 'vitest'
import type { AppEvent } from './event'

function make(type: string, payload: object, entityId = 'e-1'): AppEvent {
  return {
    id: 'evt-1',
    clientId: 'client-1',
    lamport: 1,
    timestamp: '2024-01-01T00:00:00.000Z',
    entityId,
    type,
    payload,
  } as AppEvent
}

function assertNever(x: never): never {
  throw new Error(`unreachable event: ${JSON.stringify(x)}`)
}

function payloadValue(e: AppEvent): string {
  switch (e.type) {
    case 'ShopCreated': return e.payload.name
    case 'ShopRenamed': return e.payload.name
    case 'ShopColorChanged': return e.payload.color
    case 'ShopSoftDeleted': return e.payload.deletedAt
    case 'TagCreated': return e.payload.name
    case 'TagDeleted': return ''
    case 'ItemCreated': return e.payload.name
    case 'ItemUpdated': return e.payload.name ?? ''
    case 'ItemSoftDeleted': return e.payload.deletedAt
    case 'ShopAssignedToItem': return e.payload.shopId
    case 'ShopRemovedFromItem': return e.payload.shopId
    case 'TagAssignedToItem': return e.payload.tagId
    case 'TagRemovedFromItem': return e.payload.tagId
    case 'ListCreated': return e.payload.name
    case 'ListRenamed': return e.payload.name
    case 'ListArchived': return e.payload.archivedAt
    case 'ListUnarchived': return ''
    case 'ListDeleted': return e.payload.deletedAt
    case 'ListItemAdded': return e.payload.itemId
    case 'ListItemStateChanged': return e.payload.state
    case 'ListItemQuantityChanged': return String(e.payload.quantity)
    case 'ListItemRemoved': return ''
    case 'ShopSkippedForListItem': return e.payload.shopId
    case 'ShopSkipCleared': return e.payload.shopId
    case 'ShoppingSessionStarted': return e.payload.listId
    case 'SessionItemBought': return e.payload.itemId
    case 'SessionItemSkipped': return e.payload.itemId
    case 'BugReported': return e.payload.text
    default: return assertNever(e)
  }
}

describe('AppEvent union', () => {
  it('carries the full envelope on every event', () => {
    const events = [
      make('ShopCreated', { name: 'Lidl', color: '#ff0000' }),
      make('ListItemRemoved', {}),
      make('TagCreated', { name: 'dairy' }),
    ]
    for (const e of events) {
      expect(e.id).toBeDefined()
      expect(e.clientId).toBeDefined()
      expect(e.lamport).toBeGreaterThan(0)
      expect(e.timestamp).toBeDefined()
      expect(e.entityId).toBeDefined()
      expect(e.type).toBeDefined()
      expect(e.payload).toBeDefined()
    }
  })

  it('narrows the union on the type discriminator', () => {
    const created = make('ShopCreated', { name: 'Lidl', color: '#ff0000' })
    if (created.type === 'ShopCreated') {
      expect(created.payload.name).toBe('Lidl')
      expect(created.payload.color).toBe('#ff0000')
    } else {
      throw new Error('expected ShopCreated narrowing')
    }

    const renamed = make('ShopRenamed', { name: 'New' })
    if (renamed.type === 'ShopRenamed') {
      expect(renamed.payload.name).toBe('New')
    } else {
      throw new Error('expected ShopRenamed narrowing')
    }
  })

  it('handles every union member in an exhaustive switch', () => {
    const samples: AppEvent[] = [
      make('ShopCreated', { name: 'a', color: '#000' }),
      make('ShopRenamed', { name: 'b' }),
      make('ShopColorChanged', { color: '#fff' }),
      make('ShopSoftDeleted', { deletedAt: '2024-01-01T00:00:00.000Z' }),
      make('TagCreated', { name: 'dairy' }),
      make('TagDeleted', {}),
      make('ItemCreated', { name: 'Milk' }),
      make('ItemUpdated', { unit: 'kg' }),
      make('ItemSoftDeleted', { deletedAt: '2024-01-01T00:00:00.000Z' }),
      make('ShopAssignedToItem', { shopId: 's1' }),
      make('ShopRemovedFromItem', { shopId: 's1' }),
      make('TagAssignedToItem', { tagId: 't1' }),
      make('TagRemovedFromItem', { tagId: 't1' }),
      make('ListCreated', { name: 'Weekly' }),
      make('ListRenamed', { name: 'Monthly' }),
      make('ListArchived', { archivedAt: '2024-01-01T00:00:00.000Z' }),
      make('ListUnarchived', {}),
      make('ListDeleted', { deletedAt: '2024-01-01T00:00:00.000Z' }),
      make('ListItemAdded', { listId: 'l1', itemId: 'i1', state: 'active' }),
      make('ListItemStateChanged', { state: 'bought' }),
      make('ListItemQuantityChanged', { quantity: 3, unit: 'kg' }),
      make('ListItemRemoved', {}),
      make('ShopSkippedForListItem', { shopId: 's1' }),
      make('ShopSkipCleared', { shopId: 's1' }),
      make('ShoppingSessionStarted', { listId: 'l1', shopId: 's1' }),
      make('SessionItemBought', { itemId: 'i1', quantity: 2 }),
      make('SessionItemSkipped', { itemId: 'i1' }),
      make('BugReported', { text: 'crashed' }),
    ]
    expect(samples.map(payloadValue).every(v => typeof v === 'string')).toBe(true)
  })

  it('exposes payload details through type narrowing at runtime', () => {
    const li = make('ListItemAdded', { listId: 'l1', itemId: 'i1', state: 'bought', quantity: 3, unit: 'l' })
    expect(li.type).toBe('ListItemAdded')
    if (li.type === 'ListItemAdded') {
      expect(li.payload.listId).toBe('l1')
      expect(li.payload.itemId).toBe('i1')
      expect(li.payload.state).toBe('bought')
      expect(li.payload.quantity).toBe(3)
      expect(li.payload.unit).toBe('l')
    }

    const bought = make('SessionItemBought', { itemId: 'i1', quantity: 2 })
    if (bought.type === 'SessionItemBought') {
      expect(bought.payload.itemId).toBe('i1')
      expect(bought.payload.quantity).toBe(2)
    }
  })

  it('splits state changes into their own payloads', () => {
    const qty = make('ListItemQuantityChanged', { quantity: 4, unit: 'kg' })
    if (qty.type === 'ListItemQuantityChanged') {
      expect(qty.payload.quantity).toBe(4)
      expect(qty.payload.unit).toBe('kg')
    }
    const state = make('ListItemStateChanged', { state: 'active' })
    if (state.type === 'ListItemStateChanged') {
      expect(state.payload.state).toBe('active')
    }
  })
})
