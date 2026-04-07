import { type FC } from 'react'

interface TagBadgeProps {
  name: string
  onRemove?: () => void
}

const TagBadge: FC<TagBadgeProps> = ({ name, onRemove }) => (
  <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-border text-gray-300">
    {name}
    {onRemove && (
      <button
        onClick={onRemove}
        className="text-gray-500 hover:text-gray-200 leading-none"
        aria-label={`Remove tag ${name}`}
      >
        ×
      </button>
    )}
  </span>
)

export default TagBadge
