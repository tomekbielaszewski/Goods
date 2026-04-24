import { type FC, useEffect, useState } from 'react'
import { getFrequentItems } from '../db/queries'
import type { ItemWithDetails } from '../types'

interface SuggestionsPanelProps {
  listId: string
  refresh?: number
  onAdd: (item: ItemWithDetails) => void
}

const SuggestionsPanel: FC<SuggestionsPanelProps> = ({ listId, refresh, onAdd }) => {
  const [items, setItems] = useState<ItemWithDetails[]>([])

  useEffect(() => {
    getFrequentItems(listId, 20).then(setItems)
  }, [listId, refresh])

  if (items.length === 0) return null

  return (
    <div className="pt-1">
      <div className="text-xs text-gray-500 pb-1">Not added</div>
      <div className="space-y-1">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onAdd(item)}
            className="w-full flex items-center justify-between px-3 py-2 bg-card border border-border rounded-md hover:border-blue-500 transition-colors text-left"
          >
            <span className="text-sm font-medium text-gray-300 truncate">{item.name}</span>
            {item.frequency > 0 && (
              <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{item.frequency}×</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export default SuggestionsPanel
