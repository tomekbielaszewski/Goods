export interface Shop {
  id: string
  name: string
  color: string
  version: number
  updatedAt: string
  deletedAt?: string
}

export interface Item {
  id: string
  name: string
  unit?: string
  defaultQuantity?: number
  description?: string
  notes?: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface Tag {
  id: string
  name: string
}

export interface ItemShop {
  itemId: string
  shopId: string
}

export interface ItemTag {
  itemId: string
  tagId: string
}

export interface List {
  id: string
  name: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
  archivedAt?: string
}

export interface ListItem {
  id: string
  listId: string
  itemId: string
  state: 'active' | 'bought'
  quantity?: number
  unit?: string
  notes?: string
  version: number
  addedAt: string
  updatedAt: string
}

export interface ListItemSkippedShop {
  listItemId: string
  shopId: string
  skippedAt: string
}

export interface ShoppingSession {
  id: string
  listId: string
  shopId: string
  startedAt: string
  endedAt?: string
  version: number
}

export interface SessionItem {
  id: string
  sessionId: string
  itemId: string
  action: 'bought' | 'skipped'
  quantity?: number
  unit?: string
  at: string
}

// Derived / view types

export interface ItemWithDetails extends Item {
  shops: Shop[]
  tags: Tag[]
  frequency: number        // times bought
  lastBoughtAt?: string
  lastBoughtShopId?: string
}

export interface ListItemWithItem extends ListItem {
  item: ItemWithDetails
  skippedShopIds: string[]
}

export type SortMode = 'date' | 'name' | 'frequency' | 'tag'
