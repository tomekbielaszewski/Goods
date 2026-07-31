import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
  ItemWithDetails, ListItemWithItem,
} from '../types'

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
  }

  async isEmpty(): Promise<boolean> {
    return this.items.size === 0
  }

  async getShops(): Promise<Shop[]> {
    return [...this.shops.values()]
  }

  async createShop(input: Omit<Shop, 'id' | 'version' | 'updatedAt'>): Promise<Shop> {
    const shop: Shop = {
      id: crypto.randomUUID(),
      name: input.name,
      color: input.color,
      version: 1,
      updatedAt: new Date().toISOString(),
    }
    this.shops.set(shop.id, shop)
    return shop
  }

  async updateShop(id: string, patch: Partial<Shop>): Promise<Shop> {
    const shop = this.shops.get(id)!
    const updated: Shop = { ...shop, ...patch, version: shop.version + 1, updatedAt: new Date().toISOString() }
    this.shops.set(id, updated)
    return updated
  }

  async deleteShop(id: string): Promise<void> {
    this.shops.delete(id)
  }

  async getTags(): Promise<Tag[]> {
    return [...this.tags.values()]
  }

  async createTag(name: string): Promise<Tag> {
    const tag: Tag = { id: crypto.randomUUID(), name }
    this.tags.set(tag.id, tag)
    return tag
  }

  async deleteTag(id: string): Promise<void> {
    this.tags.delete(id)
  }

  async upsertItem(item: Item, shopIds: string[], tagIds: string[]): Promise<Item> {
    this.items.set(item.id, item)
    this.itemShops = this.itemShops.filter(is => is.itemId !== item.id)
    for (const shopId of shopIds) {
      this.itemShops.push({ itemId: item.id, shopId })
    }
    this.itemTags = this.itemTags.filter(it => it.itemId !== item.id)
    for (const tagId of tagIds) {
      this.itemTags.push({ itemId: item.id, tagId })
    }
    return item
  }

  async getItemWithDetails(id: string): Promise<ItemWithDetails | undefined> {
    const item = this.items.get(id)
    if (!item) return undefined
    const enriched = this.enrichItems([item])
    return enriched[0]
  }

  async getItemsWithDetails(searchTerm?: string): Promise<ItemWithDetails[]> {
    let items = [...this.items.values()].filter(i => !i.deletedAt)
    if (searchTerm) {
      const needle = normalize(searchTerm)
      items = items.filter(i => normalize(i.name).includes(needle))
    }
    return this.enrichItems(items)
  }

  async addItemToShop(itemId: string, shopId: string): Promise<void> {
    if (!this.itemShops.some(is => is.itemId === itemId && is.shopId === shopId)) {
      this.itemShops.push({ itemId, shopId })
    }
  }

  async removeItemFromShop(itemId: string, shopId: string): Promise<void> {
    this.itemShops = this.itemShops.filter(is => !(is.itemId === itemId && is.shopId === shopId))
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

  async upsertList(list: List): Promise<List> {
    this.lists.set(list.id, list)
    return list
  }

  async deleteList(id: string): Promise<void> {
    this.lists.delete(id)
  }

  async cloneList(id: string): Promise<List> {
    const original = this.lists.get(id)!
    const now = new Date().toISOString()
    const newList: List = {
      id: crypto.randomUUID(),
      name: `Copy of ${original.name}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    this.lists.set(newList.id, newList)
    const originalItems = [...this.listItems.values()].filter(li => li.listId === id)
    for (const li of originalItems) {
      const newLi: ListItem = { ...li, id: crypto.randomUUID(), listId: newList.id }
      this.listItems.set(newLi.id, newLi)
    }
    return newList
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

  async upsertListItem(li: ListItem): Promise<ListItem> {
    this.listItems.set(li.id, li)
    return li
  }

  async updateListItemState(id: string, state: 'active' | 'bought'): Promise<ListItem> {
    const li = this.listItems.get(id)!
    const updated = { ...li, state, updatedAt: new Date().toISOString() }
    this.listItems.set(id, updated)
    return updated
  }

  async skipShopForListItem(listItemId: string, shopId: string): Promise<void> {
    if (!this.listItemSkippedShops.some(s => s.listItemId === listItemId && s.shopId === shopId)) {
      this.listItemSkippedShops.push({ listItemId, shopId, skippedAt: new Date().toISOString() })
    }
  }

  async clearSkipForListItem(listItemId: string, shopId: string): Promise<void> {
    this.listItemSkippedShops = this.listItemSkippedShops.filter(
      s => !(s.listItemId === listItemId && s.shopId === shopId)
    )
  }

  async createShoppingSession(listId: string, shopId: string): Promise<ShoppingSession> {
    const session: ShoppingSession = {
      id: crypto.randomUUID(),
      listId,
      shopId,
      startedAt: new Date().toISOString(),
      version: 1,
    }
    this.shoppingSessions.set(session.id, session)
    return session
  }

  async recordSessionItem(input: { sessionId: string; itemId: string; action: 'bought' | 'skipped'; at: string }): Promise<SessionItem> {
    const si: SessionItem = {
      id: crypto.randomUUID(),
      ...input,
    }
    this.sessionItems.push(si)
    return si
  }

  async getSessionItems(sessionId: string): Promise<SessionItem[]> {
    return this.sessionItems.filter(si => si.sessionId === sessionId)
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

export const apiClient = new ApiClient()
