import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagBadge from './TagBadge'

describe('TagBadge', () => {
  it('renders the tag name', () => {
    render(<TagBadge name="dairy" />)
    expect(screen.getByText('dairy')).toBeInTheDocument()
  })

  it('does not show × button when onRemove is not provided', () => {
    render(<TagBadge name="dairy" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows × button when onRemove is provided', () => {
    render(<TagBadge name="dairy" onRemove={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('× button has correct aria-label', () => {
    render(<TagBadge name="dairy" onRemove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Remove tag dairy' })).toBeInTheDocument()
  })

  it('calls onRemove when × button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<TagBadge name="dairy" onRemove={onRemove} />)
    await user.click(screen.getByRole('button'))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('does not call onRemove when tag name is clicked (no button)', () => {
    const onRemove = vi.fn()
    render(<TagBadge name="dairy" onRemove={onRemove} />)
    // clicking the text should not fire onRemove since it's not a button
    screen.getByText('dairy').click()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
