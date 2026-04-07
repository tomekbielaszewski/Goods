import Dexie, { type Table } from 'dexie'
import type {
  Shop, Item, Tag, ItemShop, ItemTag,
  List, ListItem, ListItemSkippedShop,
  ShoppingSession, SessionItem,
} from '../types'

export class GroceryDB extends Dexie {
  shops!: Table<Shop, string>
  items!: Table<Item, string>
  tags!: Table<Tag, string>
  itemShops!: Table<ItemShop, [string, string]>
  itemTags!: Table<ItemTag, [string, string]>
  lists!: Table<List, string>
  listItems!: Table<ListItem, string>
  listItemSkippedShops!: Table<ListItemSkippedShop, [string, string]>
  shoppingSessions!: Table<ShoppingSession, string>
  sessionItems!: Table<SessionItem, string>

  // Client-side pending sync queue
  pendingSyncIds!: Table<{ id: string; entity: string; changedAt: string }, string>

  constructor() {
    super('grocery')

    this.version(1).stores({
      shops:                  'id, updatedAt',
      items:                  'id, name, updatedAt',
      tags:                   'id, name',
      itemShops:              '[itemId+shopId], itemId, shopId',
      itemTags:               '[itemId+tagId], itemId, tagId',
      lists:                  'id, updatedAt',
      listItems:              'id, listId, itemId, state, updatedAt',
      listItemSkippedShops:   '[listItemId+shopId], listItemId',
      shoppingSessions:       'id, listId, shopId, startedAt',
      sessionItems:           'id, sessionId, itemId, at',
      pendingSyncIds:         'id, entity, changedAt',
    })
  }
}

export const db = new GroceryDB()
