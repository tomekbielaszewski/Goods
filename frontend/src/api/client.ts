import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
  ItemWithDetails, ListItemWithItem,
} from '../types'
import type { AppEvent } from '../types/event'
import { fetchRemoteEvents, publishPendingEvents, subscribeEventStream } from './transport'
import type { ServerEvent } from './transport'

type ItemCreateInput = {
  name: string
  unit?: string
  defaultQuantity?: number
  description?: string
  notes?: string
}

type ItemPatch = Partial<ItemCreateInput>

type EventInput = AppEvent extends infer U
  ? U extends AppEvent ? Omit<U, 'id' | 'clientId' | 'lamport' | 'timestamp'> : never
  : never

function normalize(s: string) {
  return s.trim().toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

class ApiClient {
  private shops = new Map<string, Shop>()
  private items = new Map<string, Item>()
  private tags = new Map<string, Tag>()
  private lists = new Map<string, List>()
  private listItems = new Map<string, ListItem>()
  private itemShops: ItemShop[] = []
  private itemTags: ItemTag[] = []
  private listItemSkippedShops: ListItemSkippedShop[] = []
  private shoppingSessions = new Map<string, ShoppingSession>()
  private sessionItems: SessionItem[] = []

  private events: AppEvent[] = []
  private outbox: AppEvent[] = []
  private clientId = crypto.randomUUID()
  private lamport = 0
  private lastTs = 0
  private lastSeq = 0
  private listeners = new Set<(e: AppEvent) => void>()
  private syncScheduled = false

  private nowIso(): string {
    const t = Math.max(Date.now(), this.lastTs + 1)
    this.lastTs = t
    return new Date(t).toISOString()
  }

  reset() {
    this.shops.clear()
    this.items.clear()
    this.tags.clear()
    this.lists.clear()
    this.listItems.clear()
    this.itemShops = []
    this.itemTags = []
    this.listItemSkippedShops = []
    this.shoppingSessions.clear()
    this.sessionItems = []
    this.events = []
    this.outbox = []
    this.lamport = 0
    this.lastSeq = 0
    this.listeners.clear()
    this.syncScheduled = false
  }

  private stamp(event: EventInput): AppEvent {
    return {
      ...event,
      id: crypto.randomUUID(),
      clientId: this.clientId,
      lamport: ++this.lamport,
      timestamp: this.nowIso(),
    }
  }

  private commit(event: EventInput) {
    const stamped = this.stamp(event)
    console.log(`[event] #${stamped.lamport} ${stamped.type}`, {
      entityId: stamped.entityId,
      payload: stamped.payload,
      timestamp: stamped.timestamp,
    })
    this.applyEvent(stamped)
    this.events.push(stamped)
    this.outbox.push(stamped)
    for (const listener of this.listeners) listener(stamped)
    this.scheduleSync()
  }

  private scheduleSync() {
    if (this.syncScheduled) return
    this.syncScheduled = true
    queueMicrotask(() => {
      this.syncScheduled = false
      this.sync().catch(() => {})
    })
  }

  private mutate<T extends { id: string; version: number; updatedAt: string }>(
    map: Map<string, T>,
    id: string,
    patch: Partial<T>,
  ) {
    const existing = map.get(id)
    if (!existing) return
    map.set(id, {
      ...existing,
      ...patch,
      version: existing.version + 1,
      updatedAt: this.nowIso(),
    })
  }

  private applyEvent(event: AppEvent) {
    switch (event.type) {
      case 'ShopCreated':
        this.shops.set(event.entityId, {
          id: event.entityId, name: event.payload.name, color: event.payload.color,
          version: 1, updatedAt: event.timestamp,
        })
        break
      case 'ShopRenamed':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'ShopColorChanged':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'ShopSoftDeleted':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'TagCreated':
        this.tags.set(event.entityId, { id: event.entityId, name: event.payload.name })
        break
      case 'TagDeleted':
        this.tags.delete(event.entityId)
        break
      case 'ItemCreated':
        this.items.set(event.entityId, {
          id: event.entityId,
          name: event.payload.name,
          unit: event.payload.unit,
          defaultQuantity: event.payload.defaultQuantity,
          description: event.payload.description,
          notes: event.payload.notes,
          version: 1,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      case 'ItemUpdated':
        this.mutate(this.items, event.entityId, event.payload)
        break
      case 'ItemSoftDeleted':
        this.mutate(this.items, event.entityId, event.payload)
        break
      case 'ShopAssignedToItem':
        if (!this.itemShops.some(is => is.itemId === event.entityId && is.shopId === event.payload.shopId)) {
          this.itemShops.push({ itemId: event.entityId, shopId: event.payload.shopId })
        }
        break
      case 'ShopRemovedFromItem':
        this.itemShops = this.itemShops.filter(is => !(is.itemId === event.entityId && is.shopId === event.payload.shopId))
        break
      case 'TagAssignedToItem':
        if (!this.itemTags.some(it => it.itemId === event.entityId && it.tagId === event.payload.tagId)) {
          this.itemTags.push({ itemId: event.entityId, tagId: event.payload.tagId })
        }
        break
      case 'TagRemovedFromItem':
        this.itemTags = this.itemTags.filter(it => !(it.itemId === event.entityId && it.tagId === event.payload.tagId))
        break
      case 'ListCreated':
        this.lists.set(event.entityId, {
          id: event.entityId, name: event.payload.name,
          version: 1, createdAt: event.timestamp, updatedAt: event.timestamp,
        })
        break
      case 'ListRenamed':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListArchived':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListUnarchived':
        this.mutate(this.lists, event.entityId, { archivedAt: undefined })
        break
      case 'ListDeleted':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListItemAdded':
        this.listItems.set(event.entityId, {
          id: event.entityId,
          listId: event.payload.listId,
          itemId: event.payload.itemId,
          state: event.payload.state,
          quantity: event.payload.quantity,
          unit: event.payload.unit,
          notes: event.payload.notes,
          version: 1,
          addedAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      case 'ListItemStateChanged':
        this.mutate(this.listItems, event.entityId, event.payload)
        break
      case 'ListItemQuantityChanged':
        this.mutate(this.listItems, event.entityId, event.payload)
        break
      case 'ListItemRemoved':
        this.listItems.delete(event.entityId)
        break
      case 'ShopSkippedForListItem':
        if (!this.listItemSkippedShops.some(s => s.listItemId === event.entityId && s.shopId === event.payload.shopId)) {
          this.listItemSkippedShops.push({ listItemId: event.entityId, shopId: event.payload.shopId, skippedAt: event.timestamp })
        }
        break
      case 'ShopSkipCleared':
        this.listItemSkippedShops = this.listItemSkippedShops.filter(
          s => !(s.listItemId === event.entityId && s.shopId === event.payload.shopId)
        )
        break
      case 'ShoppingSessionStarted':
        this.shoppingSessions.set(event.entityId, {
          id: event.entityId, listId: event.payload.listId, shopId: event.payload.shopId,
          startedAt: event.timestamp, version: 1,
        })
        break
      case 'SessionItemBought':
      case 'SessionItemSkipped':
      case 'BugReported':
        break
    }
  }

  subscribe(listener: (e: AppEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async isEmpty(): Promise<boolean> {
    return this.items.size === 0
  }

  async getShops(): Promise<Shop[]> {
    return [...this.shops.values()]
  }

  async getShop(id: string): Promise<Shop | undefined> {
    return this.shops.get(id)
  }

  async getTags(): Promise<Tag[]> {
    return [...this.tags.values()]
  }

  async getItemsWithDetails(searchTerm?: string): Promise<ItemWithDetails[]> {
    let items = [...this.items.values()].filter(i => !i.deletedAt)
    if (searchTerm) {
      const needle = normalize(searchTerm)
      items = items.filter(i => normalize(i.name).includes(needle))
    }
    return this.enrichItems(items)
  }

  async getItemWithDetails(id: string): Promise<ItemWithDetails | undefined> {
    const item = this.items.get(id)
    if (!item) return undefined
    const enriched = this.enrichItems([item])
    return enriched[0]
  }

  async getItemsForShop(shopId: string): Promise<ItemWithDetails[]> {
    const itemIds = this.itemShops.filter(is => is.shopId === shopId).map(is => is.itemId)
    const items = itemIds.map(id => this.items.get(id)).filter((i): i is Item => i != null && !i.deletedAt)
    return this.enrichItems(items)
  }

  async getFrequentItems(listId: string): Promise<ItemWithDetails[]> {
    const activeOnList = new Set(
      [...this.listItems.values()]
        .filter(li => li.listId === listId && li.state === 'active')
        .map(li => li.itemId)
    )
    const all = await this.getItemsWithDetails()
    return all
      .filter(i => !activeOnList.has(i.id))
      .sort((a, b) => b.frequency - a.frequency)
  }

  async getLists(): Promise<List[]> {
    return [...this.lists.values()]
  }

  async getList(id: string): Promise<List | undefined> {
    return this.lists.get(id)
  }

  async getListItemsWithItems(listId: string): Promise<ListItemWithItem[]> {
    const lis = [...this.listItems.values()].filter(li => li.listId === listId)
    const itemIds = [...new Set(lis.map(li => li.itemId))]
    const items = itemIds.map(id => this.items.get(id)).filter((i): i is Item => i != null)
    const enriched = this.enrichItems(items)
    const itemMap = new Map(enriched.map(i => [i.id, i]))
    return lis.map(li => ({
      ...li,
      item: itemMap.get(li.itemId)!,
      skippedShopIds: this.listItemSkippedShops
        .filter(s => s.listItemId === li.id)
        .map(s => s.shopId),
    }))
  }

  async getListItemsByItemId(itemId: string): Promise<ListItem[]> {
    return [...this.listItems.values()].filter(li => li.itemId === itemId)
  }

  async findOpenSession(listId: string, shopId: string): Promise<ShoppingSession | undefined> {
    return [...this.shoppingSessions.values()].find(s => s.listId === listId && s.shopId === shopId && !s.endedAt)
  }

  async getSessionItemsByItemId(itemId: string): Promise<SessionItem[]> {
    return this.sessionItems.filter(si => si.itemId === itemId).sort((a, b) => a.at.localeCompare(b.at))
  }

  async getShoppingSessionsByIds(ids: string[]): Promise<ShoppingSession[]> {
    const result: ShoppingSession[] = []
    for (const id of ids) {
      const s = this.shoppingSessions.get(id)
      if (s) result.push(s)
    }
    return result
  }

  async getSessionItems(sessionId: string): Promise<SessionItem[]> {
    return this.sessionItems.filter(si => si.sessionId === sessionId)
  }

  async getItemShopsByShop(shopId: string): Promise<ItemShop[]> {
    return this.itemShops.filter(is => is.shopId === shopId)
  }

  async createTagWithId(id: string, name: string): Promise<Tag> {
    const tag: Tag = { id, name }
    this.tags.set(tag.id, tag)
    return tag
  }

  async loadData(): Promise<void> {
    const { events, lastSeq } = await fetchRemoteEvents(this.lastSeq)
    for (const e of events) this.applyRemoteEvent(e)
    this.lastSeq = Math.max(this.lastSeq, lastSeq)
    await this.sync()
  }

  async sync(): Promise<void> {
    const resp = await publishPendingEvents(this.outbox)
    this.outbox = []
    this.lastSeq = Math.max(this.lastSeq, resp.lastSeq)
  }

  connectStream(): () => void {
    return subscribeEventStream(this.lastSeq, e => this.applyRemoteEvent(e))
  }

  private applyRemoteEvent(e: ServerEvent) {
    this.applyEvent(e)
    for (const listener of this.listeners) listener(e)
    this.lastSeq = Math.max(this.lastSeq, e.seq)
    this.lamport = Math.max(this.lamport, e.lamport)
  }

  // ── Mutations (granular events) ──────────────────────────────────────────────

  async createShop(input: { name: string; color: string }): Promise<Shop> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ShopCreated', payload: { name: input.name, color: input.color } })
    return this.shops.get(id)!
  }

  async renameShop(id: string, name: string): Promise<Shop> {
    this.commit({ entityId: id, type: 'ShopRenamed', payload: { name } })
    return this.shops.get(id)!
  }

  async changeShopColor(id: string, color: string): Promise<Shop> {
    this.commit({ entityId: id, type: 'ShopColorChanged', payload: { color } })
    return this.shops.get(id)!
  }

  async softDeleteShop(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ShopSoftDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async createTag(name: string): Promise<Tag> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'TagCreated', payload: { name } })
    return this.tags.get(id)!
  }

  async deleteTag(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'TagDeleted', payload: {} })
  }

  async createItem(
    input: ItemCreateInput,
    shopIds: string[],
    tagIds: string[],
    id: string = crypto.randomUUID(),
  ): Promise<Item> {
    this.commit({ entityId: id, type: 'ItemCreated', payload: { ...input } })
    for (const shopId of shopIds) {
      this.commit({ entityId: id, type: 'ShopAssignedToItem', payload: { shopId } })
    }
    for (const tagId of tagIds) {
      this.commit({ entityId: id, type: 'TagAssignedToItem', payload: { tagId } })
    }
    return this.items.get(id)!
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    this.commit({ entityId: id, type: 'ItemUpdated', payload: { ...patch } })
    return this.items.get(id)!
  }

  async assignShopToItem(itemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'ShopAssignedToItem', payload: { shopId } })
  }

  async removeShopFromItem(itemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'ShopRemovedFromItem', payload: { shopId } })
  }

  async assignTagToItem(itemId: string, tagId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'TagAssignedToItem', payload: { tagId } })
  }

  async removeTagFromItem(itemId: string, tagId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'TagRemovedFromItem', payload: { tagId } })
  }

  async saveItemShopsAndTags(itemId: string, shopIds: string[], tagIds: string[]): Promise<void> {
    const currentShops = new Set(this.itemShops.filter(is => is.itemId === itemId).map(is => is.shopId))
    const targetShops = new Set(shopIds)
    for (const shopId of currentShops) {
      if (!targetShops.has(shopId)) this.commit({ entityId: itemId, type: 'ShopRemovedFromItem', payload: { shopId } })
    }
    for (const shopId of targetShops) {
      if (!currentShops.has(shopId)) this.commit({ entityId: itemId, type: 'ShopAssignedToItem', payload: { shopId } })
    }
    const currentTags = new Set(this.itemTags.filter(it => it.itemId === itemId).map(it => it.tagId))
    const targetTags = new Set(tagIds)
    for (const tagId of currentTags) {
      if (!targetTags.has(tagId)) this.commit({ entityId: itemId, type: 'TagRemovedFromItem', payload: { tagId } })
    }
    for (const tagId of targetTags) {
      if (!currentTags.has(tagId)) this.commit({ entityId: itemId, type: 'TagAssignedToItem', payload: { tagId } })
    }
  }

  async softDeleteItem(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ItemSoftDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async createList(name: string, id: string = crypto.randomUUID()): Promise<List> {
    this.commit({ entityId: id, type: 'ListCreated', payload: { name } })
    return this.lists.get(id)!
  }

  async renameList(id: string, name: string): Promise<List> {
    this.commit({ entityId: id, type: 'ListRenamed', payload: { name } })
    return this.lists.get(id)!
  }

  async archiveList(id: string): Promise<List> {
    this.commit({ entityId: id, type: 'ListArchived', payload: { archivedAt: this.nowIso() } })
    return this.lists.get(id)!
  }

  async unarchiveList(id: string): Promise<List> {
    const list = this.lists.get(id)
    if (!list) return undefined as unknown as List
    this.commit({ entityId: id, type: 'ListUnarchived', payload: {} })
    return this.lists.get(id)!
  }

  async deleteList(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ListDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async cloneList(id: string): Promise<List> {
    const original = this.lists.get(id)!
    const newId = crypto.randomUUID()
    this.commit({ entityId: newId, type: 'ListCreated', payload: { name: `Copy of ${original.name}` } })
    const originalItems = [...this.listItems.values()].filter(li => li.listId === id)
    for (const li of originalItems) {
      this.commit({
        entityId: crypto.randomUUID(),
        type: 'ListItemAdded',
        payload: {
          listId: newId,
          itemId: li.itemId,
          state: li.state,
          quantity: li.quantity,
          unit: li.unit,
          notes: li.notes,
        },
      })
    }
    return this.lists.get(newId)!
  }

  async addListItem(input: {
    listId: string
    itemId: string
    state: 'active' | 'bought'
    quantity?: number
    unit?: string
    notes?: string
  }): Promise<ListItem> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ListItemAdded', payload: { ...input } })
    return this.listItems.get(id)!
  }

  async setListItemState(id: string, state: 'active' | 'bought'): Promise<ListItem> {
    this.commit({ entityId: id, type: 'ListItemStateChanged', payload: { state } })
    return this.listItems.get(id)!
  }

  async changeListItemQuantity(id: string, quantity?: number, unit?: string): Promise<ListItem> {
    this.commit({ entityId: id, type: 'ListItemQuantityChanged', payload: { quantity: quantity as number, unit } })
    return this.listItems.get(id)!
  }

  async removeListItem(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ListItemRemoved', payload: {} })
  }

  async skipShopForListItem(listItemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: listItemId, type: 'ShopSkippedForListItem', payload: { shopId } })
  }

  async clearSkipForListItem(listItemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: listItemId, type: 'ShopSkipCleared', payload: { shopId } })
  }

  async startShoppingSession(listId: string, shopId: string): Promise<ShoppingSession> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ShoppingSessionStarted', payload: { listId, shopId } })
    return this.shoppingSessions.get(id)!
  }

  async recordSessionItem(input: {
    sessionId: string
    itemId: string
    action: 'bought' | 'skipped'
    at: string
    quantity?: number
    unit?: string
  }): Promise<SessionItem> {
    const id = crypto.randomUUID()
    const si: SessionItem = {
      id,
      sessionId: input.sessionId,
      itemId: input.itemId,
      action: input.action,
      at: input.at,
      quantity: input.quantity,
      unit: input.unit,
    }
    this.sessionItems.push(si)
    if (input.action === 'bought') {
      this.commit({
        entityId: input.sessionId,
        type: 'SessionItemBought',
        payload: { itemId: input.itemId, quantity: input.quantity, unit: input.unit },
      })
    } else {
      this.commit({ entityId: input.sessionId, type: 'SessionItemSkipped', payload: { itemId: input.itemId } })
    }
    return si
  }

  async reportBug(text: string): Promise<string> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'BugReported', payload: { text } })
    return id
  }

  private enrichItems(items: Item[]): ItemWithDetails[] {
    const shopMap = new Map([...this.shops.entries()])
    const tagMap = new Map([...this.tags.entries()])
    const sessionMap = new Map([...this.shoppingSessions.entries()])

    const itemShopMap = new Map<string, Shop[]>()
    for (const is of this.itemShops) {
      const shop = shopMap.get(is.shopId)
      if (!shop) continue
      const arr = itemShopMap.get(is.itemId) ?? []
      arr.push(shop)
      itemShopMap.set(is.itemId, arr)
    }

    const itemTagMap = new Map<string, Tag[]>()
    for (const it of this.itemTags) {
      const tag = tagMap.get(it.tagId)
      if (!tag) continue
      const arr = itemTagMap.get(it.itemId) ?? []
      arr.push(tag)
      itemTagMap.set(it.itemId, arr)
    }

    const boughtItems = this.sessionItems.filter(si => si.action === 'bought')
    const freqMap = new Map<string, number>()
    const lastBoughtMap = new Map<string, string>()
    const lastShopMap = new Map<string, string>()

    for (const si of boughtItems) {
      freqMap.set(si.itemId, (freqMap.get(si.itemId) ?? 0) + 1)
      const prev = lastBoughtMap.get(si.itemId)
      if (!prev || si.at > prev) {
        lastBoughtMap.set(si.itemId, si.at)
      }
    }

    for (const si of boughtItems) {
      const prev = lastBoughtMap.get(si.itemId)
      if (prev && si.at >= prev) {
        const sess = sessionMap.get(si.sessionId)
        if (sess) lastShopMap.set(si.itemId, sess.shopId)
      }
    }

    return items.map(item => ({
      ...item,
      shops: itemShopMap.get(item.id) ?? [],
      tags: itemTagMap.get(item.id) ?? [],
      frequency: freqMap.get(item.id) ?? 0,
      lastBoughtAt: lastBoughtMap.get(item.id),
      lastBoughtShopId: lastShopMap.get(item.id),
    }))
  }
}

export { type ItemPatch }
export const apiClient = new ApiClient()
