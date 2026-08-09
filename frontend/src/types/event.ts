export interface EventBase {
  id: string
  clientId: string
  lamport: number
  timestamp: string
  entityId: string
  type: string
  payload: object
}

export type AppEvent =
  | (EventBase & { type: 'ShopCreated'; payload: { name: string; color: string } })
  | (EventBase & { type: 'ShopRenamed'; payload: { name: string } })
  | (EventBase & { type: 'ShopColorChanged'; payload: { color: string } })
  | (EventBase & { type: 'ShopSoftDeleted'; payload: { deletedAt: string } })
  | (EventBase & { type: 'TagCreated'; payload: { name: string } })
  | (EventBase & { type: 'TagDeleted'; payload: {} })
  | (EventBase & { type: 'ItemCreated'; payload: { name: string; unit?: string; defaultQuantity?: number; description?: string; notes?: string } })
  | (EventBase & { type: 'ItemUpdated'; payload: { name?: string; unit?: string; defaultQuantity?: number; description?: string; notes?: string } })
  | (EventBase & { type: 'ItemSoftDeleted'; payload: { deletedAt: string } })
  | (EventBase & { type: 'ShopAssignedToItem'; payload: { shopId: string } })
  | (EventBase & { type: 'ShopRemovedFromItem'; payload: { shopId: string } })
  | (EventBase & { type: 'TagAssignedToItem'; payload: { tagId: string } })
  | (EventBase & { type: 'TagRemovedFromItem'; payload: { tagId: string } })
  | (EventBase & { type: 'ListCreated'; payload: { name: string } })
  | (EventBase & { type: 'ListRenamed'; payload: { name: string } })
  | (EventBase & { type: 'ListArchived'; payload: { archivedAt: string } })
  | (EventBase & { type: 'ListDeleted'; payload: { deletedAt: string } })
  | (EventBase & { type: 'ListItemAdded'; payload: { listId: string; itemId: string; state: 'active' | 'bought'; quantity?: number; unit?: string; notes?: string } })
  | (EventBase & { type: 'ListItemStateChanged'; payload: { state: 'active' | 'bought' } })
  | (EventBase & { type: 'ListItemQuantityChanged'; payload: { quantity: number; unit?: string } })
  | (EventBase & { type: 'ListItemRemoved'; payload: {} })
  | (EventBase & { type: 'ShopSkippedForListItem'; payload: { shopId: string } })
  | (EventBase & { type: 'ShopSkipCleared'; payload: { shopId: string } })
  | (EventBase & { type: 'ShoppingSessionStarted'; payload: { listId: string; shopId: string } })
  | (EventBase & { type: 'SessionItemBought'; payload: { itemId: string; quantity?: number; unit?: string } })
  | (EventBase & { type: 'SessionItemSkipped'; payload: { itemId: string } })
