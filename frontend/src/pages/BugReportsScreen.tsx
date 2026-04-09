import { type FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface BugReport {
  id: string
  text: string
  created_at: string
  resolved_at: string | null
}

const BugReportsScreen: FC = () => {
  const navigate = useNavigate()
  const [reports, setReports] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/bug-reports')
      if (!res.ok) throw new Error('server error')
      setReports(await res.json())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const resolve = async (id: string) => {
    try {
      const res = await fetch(`/api/bug-reports/${id}/resolve`, { method: 'POST' })
      if (!res.ok) throw new Error('server error')
      setReports(prev => prev.map(r => r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r))
    } catch {
      // silent — the item stays unresolved
    }
  }

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/settings')}
          className="text-gray-500 hover:text-gray-200 transition-colors"
          aria-label="Back to settings"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-100">Bug Reports</h1>
      </div>

      {loading && <div className="text-xs text-gray-500 py-4 text-center">Loading…</div>}
      {error && <div className="text-xs text-red-400 py-4 text-center">Failed to load bug reports.</div>}

      {!loading && !error && reports.length === 0 && (
        <div className="text-xs text-gray-500 py-4 text-center">No bug reports yet.</div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div className="space-y-2">
          {reports.map(report => (
            <div
              key={report.id}
              className={`flex items-start gap-3 px-3 py-2.5 bg-card border rounded-md ${report.resolved_at ? 'border-border opacity-50' : 'border-border'}`}
            >
              <p className={`flex-1 text-sm break-words min-w-0 ${report.resolved_at ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                {report.text}
              </p>
              {!report.resolved_at && (
                <button
                  onClick={() => void resolve(report.id)}
                  className="shrink-0 text-xs text-gray-500 hover:text-green-400 px-1.5 py-0.5 transition-colors"
                  title="Mark as resolved"
                >
                  Done
                </button>
              )}
              {report.resolved_at && (
                <span className="shrink-0 text-xs text-gray-600">Resolved</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BugReportsScreen
