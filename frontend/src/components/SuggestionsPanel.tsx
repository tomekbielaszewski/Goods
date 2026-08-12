import { type FC, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import type { ItemWithDetails } from '../types'

interface SuggestionsPanelProps {
  listId: string
  refresh?: number
  onAdd: (item: ItemWithDetails) => void
}

interface RemovingRow {
  item: ItemWithDetails
  index: number
}

const COLLAPSE_MS = 250

const SuggestionsPanel: FC<SuggestionsPanelProps> = ({ listId, refresh, onAdd }) => {
  const [items, setItems] = useState<ItemWithDetails[]>([])
  const [removing, setRemoving] = useState<RemovingRow[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    apiClient.getFrequentItems(listId).then(setItems)
  }, [listId, refresh])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const handleAdd = async (item: ItemWithDetails) => {
    const index = items.findIndex(i => i.id === item.id)
    setRemoving(prev => [...prev, { item, index: index < 0 ? items.length : index }])
    try {
      await onAdd(item)
    } catch {
      setRemoving(prev => prev.filter(r => r.item.id !== item.id))
      return
    }
    timers.current.push(setTimeout(() => {
      setRemoving(prev => prev.filter(r => r.item.id !== item.id))
    }, COLLAPSE_MS))
  }

  const rows = [...items]
  for (const { item, index } of removing) {
    if (!items.some(i => i.id === item.id)) {
      rows.splice(Math.min(index, rows.length), 0, item)
    }
  }

  if (rows.length === 0) return null

  const removingIds = new Set(removing.map(r => r.item.id))

  return (
    <div className="pt-1">
      <div className="text-xs text-gray-500 pb-1">Not added</div>
      <div className="space-y-1">
        {rows.map(item => (
          <div
            key={item.id}
            className={removingIds.has(item.id)
              ? 'grid transition-all duration-200 grid-rows-[0fr] opacity-0 pointer-events-none'
              : 'grid transition-all duration-200 grid-rows-[1fr]'}
          >
            <div className="overflow-hidden">
              <button
                onClick={() => void handleAdd(item)}
                className="w-full flex items-center justify-between px-3 py-2 bg-card border border-border rounded-md transition-colors text-left"
              >
                <span className="text-sm font-medium text-gray-300 truncate">{item.name}</span>
                {item.frequency > 0 && (
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{item.frequency}×</span>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SuggestionsPanel
