import { type FC, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

const SyncStatusBar: FC = () => {
  const { syncStatus, syncFailed, conflicts, setSyncStatus } = useStore()
  const navigate = useNavigate()

  // After a successful sync, hold the green dot for 600ms then return to idle
  useEffect(() => {
    if (syncStatus !== 'synced') return
    const timer = setTimeout(() => setSyncStatus('idle'), 600)
    return () => clearTimeout(timer)
  }, [syncStatus, setSyncStatus])

  const dotColor =
    syncFailed                                              ? 'bg-red-500' :
    syncStatus === 'syncing' || syncStatus === 'synced'     ? 'bg-green-400' :
    'bg-gray-600'

  return (
    <div className="h-6 flex items-center justify-between px-3 text-xs border-b border-border">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      </span>

      {conflicts.length > 0 && (
        <button
          onClick={() => navigate('/conflicts')}
          className="text-amber-400 hover:text-amber-300 transition-colors"
        >
          ⚠ {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}

export default SyncStatusBar
