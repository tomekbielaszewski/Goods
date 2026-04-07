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

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="flex-1 text-sm font-semibold text-gray-100">Item Catalog</h1>
          <button
            onClick={() => navigate('/item/new')}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            + New item
          </button>
        </div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search items…"
          className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-sm">
            {query ? 'No items match your search.' : 'No items yet. Add your first item!'}
          </div>
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
    </div>
  )
}

export default RepositoryScreen
