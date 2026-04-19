import { type FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/schema'
import type { Shop } from '../types'
import ShopDot from '../components/ShopDot'

const PALETTE = [
  '#ef4444', '#6e2600', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f43f5e', '#06b6d4', '#84cc16', '#a78bfa',
]

const SettingsScreen: FC = () => {
  const navigate = useNavigate()
  const [shops, setShops] = useState<Shop[]>([])
  const [name, setName]   = useState('')
  const [color, setColor] = useState(PALETTE[0]!)
  const [editId, setEditId] = useState<string | null>(null)

  const [bugText, setBugText] = useState('')
  const [bugStatus, setBugStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const submitBug = async () => {
    if (!bugText.trim()) return
    setBugStatus('sending')
    try {
      const res = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bugText.trim() }),
      })
      if (!res.ok) throw new Error('server error')
      setBugText('')
      setBugStatus('sent')
      setTimeout(() => setBugStatus('idle'), 3000)
    } catch {
      setBugStatus('error')
    }
  }

  const load = () => db.shops.filter(s => !s.deletedAt).toArray().then(setShops)
  useEffect(() => { void load() }, [])

  const save = async () => {
    if (!name.trim()) return
    const now = new Date().toISOString()
    if (editId) {
      const existing = shops.find(s => s.id === editId)
      if (!existing) return
      await db.shops.put({ ...existing, name: name.trim(), color, version: existing.version + 1, updatedAt: now })
    } else {
      await db.shops.add({ id: crypto.randomUUID(), name: name.trim(), color, version: 1, updatedAt: now })
    }
    setName(''); setColor(PALETTE[0]!); setEditId(null)
    void load()
  }

  const startEdit = (shop: Shop) => {
    setEditId(shop.id); setName(shop.name); setColor(shop.color)
  }

  const deleteShop = async (id: string) => {
    await db.shops.update(id, { deletedAt: new Date().toISOString() })
    void load()
  }

  return (
    <div className="p-3 space-y-4">
      <h1 className="text-base font-semibold text-gray-100">Settings</h1>

      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Shops</h2>

        <div className="space-y-1.5 mb-3">
          {shops.map(shop => (
            <div key={shop.id} className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-md">
              <ShopDot color={shop.color} />
              <span className="flex-1 text-sm text-gray-200">{shop.name}</span>
              <button onClick={() => navigate(`/shop/${shop.id}`)} className="text-xs text-gray-500 hover:text-gray-200 px-1.5 py-0.5 transition-colors">Items</button>
              <button onClick={() => startEdit(shop)} className="text-xs text-gray-500 hover:text-gray-200 px-1.5 py-0.5 transition-colors">Edit</button>
              <button onClick={() => void deleteShop(shop.id)} aria-label="Delete shop" className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {shops.length === 0 && <div className="text-xs text-gray-500 py-2">No shops yet.</div>}
        </div>

        {/* Add / edit form */}
        <div className="bg-card border border-border rounded-md p-3 space-y-2">
          <div className="text-xs text-gray-500">{editId ? 'Edit shop' : 'Add shop'}</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void save() }}
            placeholder="Shop name…"
            className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            {PALETTE.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white/50' : ''}`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
            {/* Custom color picker */}
            <label
              className={`relative w-5 h-5 rounded-full overflow-hidden cursor-pointer transition-transform ${!PALETTE.includes(color) ? 'scale-125 ring-2 ring-white/50' : ''}`}
              style={{ backgroundColor: !PALETTE.includes(color) ? color : '#ffffff22' }}
              title="Custom color"
            >
              <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white/70 select-none">+</span>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={!name.trim()}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded transition-colors"
            >
              {editId ? 'Save' : 'Add shop'}
            </button>
            {editId && (
              <button
                onClick={() => { setEditId(null); setName(''); setColor(PALETTE[0]!) }}
                className="px-3 py-1.5 border border-border text-xs text-gray-400 rounded hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Report a bug</h2>
        <div className="bg-card border border-border rounded-md p-3 space-y-2">
          <textarea
            value={bugText}
            onChange={e => setBugText(e.target.value)}
            placeholder="Describe the issue…"
            rows={4}
            className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void submitBug()}
              disabled={!bugText.trim() || bugStatus === 'sending'}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded transition-colors"
            >
              {bugStatus === 'sending' ? 'Sending…' : 'Submit'}
            </button>
            {bugStatus === 'sent' && <span className="text-xs text-green-400">Sent!</span>}
            {bugStatus === 'error' && <span className="text-xs text-red-400">Failed to send.</span>}
          </div>
          <button
            onClick={() => navigate('/bug-reports')}
            className="w-full py-1.5 border border-border text-xs text-gray-400 hover:text-gray-200 rounded transition-colors"
          >
            View all bug reports
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2">About</h2>
        <div className="px-3 py-2 bg-card border border-border rounded-md text-xs text-gray-500">Groceries v0.1.0 — offline-first groceries management</div>
      </section>
    </div>
  )
}

export default SettingsScreen
