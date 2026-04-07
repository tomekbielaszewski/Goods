import { type FC } from 'react'

interface ShopDotProps {
  color: string
  skipped?: boolean
  title?: string
}

const ShopDot: FC<ShopDotProps> = ({ color, skipped, title }) => (
  <span
    title={title}
    className="relative inline-flex items-center justify-center w-2.5 h-2.5 rounded-full flex-shrink-0"
    style={{ backgroundColor: skipped ? undefined : color, border: skipped ? `2px solid ${color}` : undefined, opacity: skipped ? 0.4 : 1 }}
  >
    {skipped && (
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: 'rotate(-45deg)' }}
      >
        <span className="block w-full h-px" style={{ backgroundColor: color }} />
      </span>
    )}
  </span>
)

export default ShopDot
