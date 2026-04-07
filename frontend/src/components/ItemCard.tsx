import { type FC, useRef, useState, useEffect } from 'react'
import type { ItemWithDetails, ListItemWithItem } from '../types'
import ShopDot from './ShopDot'
import TagBadge from './TagBadge'

// ── Repository mode ──────────────────────────────────────────────────────────
interface RepositoryCardProps {
  mode: 'repository'
  item: ItemWithDetails
  onClick?: () => void
}

// ── Browse mode ──────────────────────────────────────────────────────────────
interface BrowseCardProps {
  mode: 'browse'
  listItem: ListItemWithItem
  shops: { id: string; name: string; color: string }[]
  onToggle: () => void
  onRemove: () => void
  onQuantityChange: (qty: number | undefined, unit: string | undefined) => void
  onClick?: () => void
}

// ── Shopping mode ────────────────────────────────────────────────────────────
interface ShoppingCardProps {
  mode: 'shopping'
  listItem: ListItemWithItem
  activeShopId: string
  onBuy: () => void
  onSkip: () => void
  onUndo: () => void
}

type ItemCardProps = RepositoryCardProps | BrowseCardProps | ShoppingCardProps

const ItemCard: FC<ItemCardProps> = (props) => {
  if (props.mode === 'repository') return <RepositoryCard {...props} />
  if (props.mode === 'browse')     return <BrowseCard {...props} />
  return <ShoppingCard {...props} />
}

// ── Repository ───────────────────────────────────────────────────────────────
const RepositoryCard: FC<RepositoryCardProps> = ({ item, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-2.5 bg-card border border-border rounded-md hover:border-gray-600 transition-colors text-left"
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-100 truncate">{item.name}</span>
        {item.unit && <span className="text-xs text-gray-500">{item.unit}</span>}
      </div>
      {item.tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {item.tags.map(t => <TagBadge key={t.id} name={t.name} />)}
        </div>
      )}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="flex gap-1">
        {item.shops.map(s => <ShopDot key={s.id} color={s.color} title={s.name} />)}
      </div>
      {item.frequency > 0 && (
        <span className="text-xs text-gray-500">{item.frequency}×</span>
      )}
    </div>
  </button>
)

// ── Browse ───────────────────────────────────────────────────────────────────
const BrowseCard: FC<BrowseCardProps> = ({ listItem, onToggle, onRemove, onQuantityChange, onClick }) => {
  const bought = listItem.state === 'bought'
  const defaultUnit = listItem.unit ?? listItem.item.unit ?? ''
  const defaultQty  = listItem.quantity != null ? String(listItem.quantity) : ''

  const [qty, setQty]   = useState(defaultQty)
  const [unit, setUnit] = useState(defaultUnit)

  // Keep local state in sync when the listItem changes from the outside
  useEffect(() => { setQty(listItem.quantity != null ? String(listItem.quantity) : '') }, [listItem.quantity])
  useEffect(() => { setUnit(listItem.unit ?? listItem.item.unit ?? '') }, [listItem.unit, listItem.item.unit])

  const commitQty = () => {
    const parsed = qty.trim() === '' ? undefined : Number(qty)
    const u      = unit.trim() || undefined
    onQuantityChange(parsed, u)
  }

  const hasTags  = listItem.item.tags.length > 0
  const hasShops = listItem.item.shops.length > 0

  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-card border rounded-md transition-colors ${bought ? 'border-border opacity-60' : 'border-border'}`}>
      {/* Checkbox */}
      <button
        onClick={onToggle}
        aria-label={bought ? 'Mark active' : 'Mark bought'}
        className={`w-4 h-4 rounded border flex-shrink-0 transition-colors ${bought ? 'bg-blue-600 border-blue-600' : 'border-gray-500 hover:border-blue-500'}`}
      >
        {bought && <svg viewBox="0 0 12 12" fill="white" className="w-full h-full p-0.5"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
      </button>

      {/* Name */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <span className={`text-sm font-medium truncate block ${bought ? 'line-through text-gray-500' : 'text-gray-100'}`}>
          {listItem.item.name}
        </span>
      </div>

      {/* Qty + unit inputs (browse mode only, not bought) */}
      {!bought && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="number"
            value={qty}
            min={0}
            onChange={e => setQty(e.target.value)}
            onBlur={commitQty}
            onKeyDown={e => { if (e.key === 'Enter') { commitQty(); (e.target as HTMLInputElement).blur() } }}
            placeholder="qty"
            className="w-12 bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500 text-right"
          />
          <input
            type="text"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            onBlur={commitQty}
            onKeyDown={e => { if (e.key === 'Enter') { commitQty(); (e.target as HTMLInputElement).blur() } }}
            placeholder="unit"
            className="w-10 bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Tags (top) + shop dots (bottom), right-aligned column */}
      {(hasTags || hasShops) && (
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {hasTags && (
            <div className="flex gap-1 flex-wrap justify-end">
              {listItem.item.tags.map(t => <TagBadge key={t.id} name={t.name} />)}
            </div>
          )}
          {hasShops && (
            <div className="flex gap-1">
              {listItem.item.shops.map(s => (
                <ShopDot
                  key={s.id}
                  color={s.color}
                  skipped={listItem.skippedShopIds.includes(s.id)}
                  title={s.name}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Remove */}
      <button
        onClick={onRemove}
        aria-label="Remove from list"
        className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 p-1"
      >
        ×
      </button>
    </div>
  )
}

// ── Shopping ─────────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 60

const ShoppingCard: FC<ShoppingCardProps> = ({ listItem, onBuy, onSkip, onUndo }) => {
  const bought = listItem.state === 'bought'
  const touchStartX = useRef(0)
  const [swipeDelta, setSwipeDelta] = useState(0)
  const [swiping, setSwiping] = useState(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]!.clientX
    setSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0]!.clientX - touchStartX.current
    if (delta < 0) setSwipeDelta(delta)
  }

  const handleTouchEnd = () => {
    setSwiping(false)
    if (swipeDelta < -SWIPE_THRESHOLD) onSkip()
    setSwipeDelta(0)
  }

  if (bought) {
    return (
      <button
        onClick={onUndo}
        className="w-full flex items-center gap-3 px-3 py-2 opacity-50 text-left"
      >
        <span className="text-sm line-through text-gray-500 truncate">{listItem.item.name}</span>
        {(listItem.quantity ?? listItem.item.unit) && (
          <span className="text-xs text-gray-600">{listItem.quantity}{listItem.unit ?? listItem.item.unit}</span>
        )}
      </button>
    )
  }

  const skipProgress = Math.min(Math.abs(swipeDelta) / SWIPE_THRESHOLD, 1)

  return (
    <div className="relative overflow-hidden rounded-md">
      {/* Skip hint background */}
      <div
        className="absolute inset-0 flex items-center justify-end pr-4 bg-orange-900/60"
        style={{ opacity: skipProgress }}
      >
        <span className="text-xs text-orange-300 font-medium">Skip here</span>
      </div>

      <button
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={!swiping ? onBuy : undefined}
        className="relative w-full flex items-center gap-3 px-3 py-3 bg-card border border-border rounded-md active:bg-border transition-colors text-left"
        style={{ transform: `translateX(${swipeDelta}px)`, transition: swiping ? 'none' : 'transform 0.2s ease' }}
      >
        <div className="w-5 h-5 rounded-full border-2 border-gray-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-100">{listItem.item.name}</span>
          {(listItem.quantity ?? listItem.item.unit) && (
            <span className="ml-2 text-xs text-gray-500">{listItem.quantity}{listItem.unit ?? listItem.item.unit}</span>
          )}
        </div>
        <div className="flex gap-1">
          {listItem.item.shops.map(s => (
            <ShopDot key={s.id} color={s.color} />
          ))}
        </div>
      </button>
    </div>
  )
}

export default ItemCard
