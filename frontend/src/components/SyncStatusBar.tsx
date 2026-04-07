import { type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

const SyncStatusBar: FC = () => {
  const { syncStatus, conflicts } = useStore()
  const navigate = useNavigate()

  if (syncStatus === 'idle' && conflicts.length === 0) return null

  return (
    <div className="h-6 flex items-center justify-between px-3 text-xs border-b border-border">
      <span className={
        syncStatus === 'syncing' ? 'text-blue-400 flex items-center gap-1' :
        syncStatus === 'error'   ? 'text-red-400' :
        syncStatus === 'offline' ? 'text-gray-500' : 'text-gray-500'
      }>
        {syncStatus === 'syncing' && (
          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
          </svg>
        )}
        {syncStatus === 'syncing' && 'Syncing…'}
        {syncStatus === 'error'   && 'Sync error'}
        {syncStatus === 'offline' && 'Offline'}
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
