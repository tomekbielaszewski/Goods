import { type FC } from 'react'
import type { SortMode } from '../types'

interface SortToggleProps {
  value: SortMode
  onChange: (m: SortMode) => void
}

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'date',      label: 'Date' },
  { value: 'name',      label: 'Name' },
  { value: 'frequency', label: 'Freq' },
]

const SortToggle: FC<SortToggleProps> = ({ value, onChange }) => (
  <div className="flex rounded overflow-hidden border border-border text-xs">
    {OPTIONS.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`px-2 py-1 transition-colors ${
          value === opt.value
            ? 'bg-blue-600 text-white'
            : 'text-gray-400 hover:text-gray-200 hover:bg-border'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
)

export default SortToggle
