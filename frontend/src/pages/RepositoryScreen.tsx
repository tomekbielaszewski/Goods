import { type FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getItemsWithDetails } from '../db/queries'
import type { ItemWithDetails } from '../types'
import ItemCard from '../components/ItemCard'

const RepositoryScreen: FC = () => {
  const [items, setItems] = useState<ItemWithDetails[]>([])
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    getItemsWithDetails(query || undefined)
      .then(all => setItems(all.filter(i => !i.deletedAt).sort((a, b) => a.name.localeCompare(b.name))))
  }, [query])

  const exactMatch = items.some(i => i.name.toLowerCase() === query.toLowerCase())

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <h1 className="text-sm font-semibold text-gray-100">Item Catalog</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {items.length === 0 && !query && (
          <div className="text-center py-12 text-gray-500 text-sm">No items yet. Add your first item!</div>
        )}
        {query.trim() && !exactMatch && (
          <button
            onClick={() => navigate(`/item/new?name=${encodeURIComponent(query.trim())}`)}
            className="w-full px-3 py-2.5 bg-card border border-dashed border-blue-500/50 rounded-md text-sm text-blue-400 hover:border-blue-500 hover:bg-blue-500/5 transition-colors text-left"
          >
            + Create "{query.trim()}"
          </button>
        )}
        {items.map(item => (
          <ItemCard
            key={item.id}
            mode="repository"
            item={item}
            onClick={() => navigate(`/item/${item.id}`)}
          />
        ))}
      </div>

      <div className="px-3 pt-2 pb-3 border-t border-border space-y-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim() && !exactMatch)
              navigate(`/item/new?name=${encodeURIComponent(query.trim())}`)
          }}
          placeholder="Search items…"
          className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
        <button
          onClick={() => navigate('/item/new')}
          className="w-full text-sm py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          + New item
        </button>
      </div>
    </div>
  )
}

export default RepositoryScreen
