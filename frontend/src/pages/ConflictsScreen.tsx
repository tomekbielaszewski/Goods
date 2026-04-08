import { type FC, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { db } from '../db/schema'
import type { Conflict } from '../types'

const REDIRECT_DELAY = 3000

const ConflictsScreen: FC = () => {
  const { conflicts, resolveConflict } = useStore()
  const navigate = useNavigate()
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  const allResolved = conflicts.length === 0

  useEffect(() => {
    if (!allResolved) {
      // Reset if new conflicts arrive
      setProgress(0)
      startRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const p = Math.min(elapsed / REDIRECT_DELAY, 1)
      setProgress(p)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        navigate('/')
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [allResolved, navigate])

  if (allResolved) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
        <div className="text-sm text-gray-400">All conflicts resolved</div>
        <div className="w-full max-w-xs h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="text-xs text-gray-600">Returning to lists…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border">
        <button onClick={() => navigate(-1)} aria-label="Back" className="text-gray-400 hover:text-gray-200 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-gray-100">Conflicts ({conflicts.length})</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {conflicts.map(conflict => (
          <ConflictCard
            key={`${conflict.entity}-${conflict.id}`}
            conflict={conflict}
            onResolve={(choice) => void resolveAndApply(conflict, choice, resolveConflict)}
          />
        ))}
      </div>
    </div>
  )
}

async function resolveAndApply(
  conflict: Conflict,
  choice: 'mine' | 'server',
  resolveConflict: (entity: string, id: string) => void,
) {
  if (choice === 'server') {
    const data = conflict.server as Record<string, unknown>
    const id = conflict.id
    if (conflict.entity === 'item') await db.items.put(data as unknown as Parameters<typeof db.items.put>[0])
    if (conflict.entity === 'list') await db.lists.put(data as unknown as Parameters<typeof db.lists.put>[0])
    if (conflict.entity === 'shop') await db.shops.put(data as unknown as Parameters<typeof db.shops.put>[0])
    if (conflict.entity === 'listItem') await db.listItems.put(data as unknown as Parameters<typeof db.listItems.put>[0])
    void id
  }
  // 'mine' = keep local, no action needed
  resolveConflict(conflict.entity, conflict.id)
}

const ConflictCard: FC<{ conflict: Conflict; onResolve: (c: 'mine' | 'server') => void }> = ({ conflict, onResolve }) => {
  const client = conflict.client as Record<string, unknown>
  const server = conflict.server as Record<string, unknown>

  const changedKeys = Object.keys({ ...client, ...server }).filter(k => {
    const cv = JSON.stringify(client[k])
    const sv = JSON.stringify(server[k])
    return cv !== sv
  })

  const displayName = (client['name'] ?? server['name'] ?? conflict.id) as string

  return (
    <div className="bg-card border border-amber-900/50 rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-amber-900/20 border-b border-amber-900/30">
        <div className="text-xs text-amber-400 font-medium capitalize">{conflict.entity}: {displayName}</div>
        <div className="text-xs text-gray-500">{changedKeys.length} field{changedKeys.length !== 1 ? 's' : ''} differ</div>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">Mine</div>
            {changedKeys.map(k => (
              <div key={k} className="text-xs">
                <span className="text-gray-500">{k}: </span>
                <span className="text-green-400">{String(client[k] ?? '—')}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Server</div>
            {changedKeys.map(k => (
              <div key={k} className="text-xs">
                <span className="text-gray-500">{k}: </span>
                <span className="text-blue-400">{String(server[k] ?? '—')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onResolve('mine')}
            className="flex-1 py-1.5 text-xs border border-green-800 text-green-400 rounded hover:bg-green-900/30 transition-colors"
          >
            Keep mine
          </button>
          <button
            onClick={() => onResolve('server')}
            className="flex-1 py-1.5 text-xs border border-blue-800 text-blue-400 rounded hover:bg-blue-900/30 transition-colors"
          >
            Use server
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConflictsScreen
