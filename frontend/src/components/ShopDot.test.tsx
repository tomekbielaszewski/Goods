import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShopDot from './ShopDot'

describe('ShopDot', () => {
  it('renders with correct background color when not skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" />)
    const dot = container.firstChild as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)')
    // opacity is 1 (full) when not skipped
    expect(dot.style.opacity).toBe('1')
  })

  it('has no background color when skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" skipped />)
    const dot = container.firstChild as HTMLElement
    expect(dot.style.backgroundColor).toBe('')
  })

  it('has reduced opacity when skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" skipped />)
    const dot = container.firstChild as HTMLElement
    expect(dot.style.opacity).toBe('0.4')
  })

  it('has border with the given color when skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" skipped />)
    const dot = container.firstChild as HTMLElement
    expect(dot.style.border).toContain('#ff0000')
  })

  it('renders strikethrough line when skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" skipped />)
    // Should contain the inner line element
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1)
  })

  it('does not render strikethrough line when not skipped', () => {
    const { container } = render(<ShopDot color="#ff0000" />)
    // Only the outer span, no inner skipped indicator
    expect(container.querySelectorAll('span')).toHaveLength(1)
  })

  it('shows title attribute when provided', () => {
    const { container } = render(<ShopDot color="#00ff00" title="Whole Foods" />)
    const dot = container.firstChild as HTMLElement
    expect(dot.getAttribute('title')).toBe('Whole Foods')
  })

  it('does not set title attribute when not provided', () => {
    const { container } = render(<ShopDot color="#00ff00" />)
    const dot = container.firstChild as HTMLElement
    expect(dot.getAttribute('title')).toBeNull()
  })
})
