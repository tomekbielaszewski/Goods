import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortToggle from './SortToggle'

describe('SortToggle', () => {
  it('renders all 3 option buttons', () => {
    render(<SortToggle value="date" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Freq' })).toBeInTheDocument()
  })

  it('active option has blue background class', () => {
    render(<SortToggle value="name" onChange={() => {}} />)
    const activeBtn = screen.getByRole('button', { name: 'Name' })
    expect(activeBtn).toHaveClass('bg-blue-600')
    expect(activeBtn).toHaveClass('text-white')
  })

  it('inactive options do not have blue background', () => {
    render(<SortToggle value="name" onChange={() => {}} />)
    const inactiveDate = screen.getByRole('button', { name: 'Date' })
    const inactiveFreq = screen.getByRole('button', { name: 'Freq' })
    expect(inactiveDate).not.toHaveClass('bg-blue-600')
    expect(inactiveFreq).not.toHaveClass('bg-blue-600')
  })

  it('clicking inactive "Name" option calls onChange with "name"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SortToggle value="date" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('name')
  })

  it('clicking inactive "Freq" option calls onChange with "frequency"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SortToggle value="date" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Freq' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('frequency')
  })

  it('clicking inactive "Date" option calls onChange with "date"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SortToggle value="name" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Date' }))
    expect(onChange).toHaveBeenCalledWith('date')
  })

  it('clicking already-active option still calls onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SortToggle value="date" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Date' }))
    expect(onChange).toHaveBeenCalledWith('date')
  })

  it('active option changes when value prop changes', () => {
    const { rerender } = render(<SortToggle value="date" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Date' })).toHaveClass('bg-blue-600')

    rerender(<SortToggle value="frequency" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Freq' })).toHaveClass('bg-blue-600')
    expect(screen.getByRole('button', { name: 'Date' })).not.toHaveClass('bg-blue-600')
  })
})
