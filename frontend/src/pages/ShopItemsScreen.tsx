import { type FC, useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../db/schema'
import type { Shop, ItemWithDetails } from '../types'
import { getItemsWithDetails, addItemToShop, removeItemFromShop } from '../db/queries'
import TagBadge from '../components/TagBadge'
import ShopDot from '../components/ShopDot'

const normalize = (s: string) =>
  s.trim().toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const ShopItemsScreen: FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [shop, setShop] = useState<Shop | null>(null)
  const [allItems, setAllItems] = useState<ItemWithDetails[]>([])
  const [shopItemIds, setShopItemIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const load = async () => {
    if (!id) return
    const [s, itemShops, items] = await Promise.all([
      db.shops.get(id),
      db.itemShops.where('shopId').equals(id).toArray(),
      getItemsWithDetails(),
    ])
    setShop(s ?? null)
    setShopItemIds(new Set(itemShops.map(is => is.itemId)))
    setAllItems(items.sort((a, b) => a.name.localeCompare(b.name)))
  }

  useEffect(() => { void load() }, [id])

  const toggle = async (item: ItemWithDetails) => {
    if (!id) return
    if (shopItemIds.has(item.id)) {
      await removeItemFromShop(item.id, id)
      setShopItemIds(prev => { const s = new Set(prev); s.delete(item.id); return s })
    } else {
      await addItemToShop(item.id, id)
      setShopItemIds(prev => new Set(prev).add(item.id))
    }
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return allItems
    const needle = normalize(filter)
    return allItems.filter(i => normalize(i.name).includes(needle))
  }, [allItems, filter])

  const inShop  = filtered.filter(i => shopItemIds.has(i.id))
  const notInShop = filtered.filter(i => !shopItemIds.has(i.id))

  if (!shop) return null

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/settings')}
          aria-label="Back to settings"
          className="text-gray-500 hover:text-gray-200 transition-colors p-1 -ml-1"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <ShopDot color={shop.color} />
        <h1 className="text-base font-semibold text-gray-100">{shop.name}</h1>
        <span className="text-xs text-gray-500 ml-auto">{shopItemIds.size} / {allItems.length}</span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter items…"
        className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />

      {filtered.length === 0 && (
        <div className="text-xs text-gray-500 py-6 text-center">No items match.</div>
      )}

      {inShop.length > 0 && (
        <section>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">In this shop</div>
          <div className="space-y-1.5">
            {inShop.map(item => (
              <ItemRow key={item.id} item={item} inShop shopColor={shop.color} onToggle={() => void toggle(item)} />
            ))}
          </div>
        </section>
      )}

      {inShop.length > 0 && notInShop.length > 0 && (
        <div className="border-t border-border" />
      )}

      {notInShop.length > 0 && (
        <section>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Not in this shop</div>
          <div className="space-y-1.5">
            {notInShop.map(item => (
              <ItemRow key={item.id} item={item} inShop={false} shopColor={shop.color} onToggle={() => void toggle(item)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

interface ItemRowProps {
  item: ItemWithDetails
  inShop: boolean
  shopColor: string
  onToggle: () => void
}

const ItemRow: FC<ItemRowProps> = ({ item, inShop, shopColor, onToggle }) => (
  <button
    onClick={onToggle}
    className={`w-full flex items-center gap-3 px-3 py-2 bg-card border rounded-md transition-colors text-left ${
      inShop ? 'border-border' : 'border-border opacity-50 hover:opacity-80'
    }`}
  >
    <div
      className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
        inShop ? 'border-transparent' : 'border-gray-600'
      }`}
      style={inShop ? { backgroundColor: shopColor } : undefined}
    >
      {inShop && (
        <svg viewBox="0 0 12 12" className="w-full h-full p-0.5" fill="none">
          <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-100 truncate">{item.name}</span>
        {item.unit && <span className="text-xs text-gray-500">{item.unit}</span>}
      </div>
      {item.tags.length > 0 && (
        <div className="flex gap-1 mt-0.5 flex-wrap">
          {item.tags.map(t => <TagBadge key={t.id} name={t.name} />)}
        </div>
      )}
    </div>
  </button>
)

export default ShopItemsScreen
