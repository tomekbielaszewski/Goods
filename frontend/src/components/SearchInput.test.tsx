import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchInput from './SearchInput'
import type { ItemWithDetails } from '../types'

// Mock the DB query so we don't need real IndexedDB data
vi.mock('../db/queries', () => ({
  getItemsWithDetails: vi.fn(),
}))

import { getItemsWithDetails } from '../db/queries'

const makeItem = (overrides?: Partial<ItemWithDetails>): ItemWithDetails => ({
  id: 'item-1',
  name: 'Jabłka',
  version: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  shops: [],
  tags: [],
  frequency: 3,
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SearchInput — Enter key behaviour', () => {
  beforeEach(() => {
    vi.mocked(getItemsWithDetails).mockResolvedValue([makeItem()])
  })

  it('selects the top result on Enter when results exist (does NOT call onCreateNew)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'jabl')

    // Wait for the suggestions dropdown to appear
    await waitFor(() => expect(screen.getByText('Jabłka')).toBeInTheDocument())

    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(makeItem())
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('calls onCreateNew on Enter only when there are no results', async () => {
    vi.mocked(getItemsWithDetails).mockResolvedValue([])
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'brandnewitem')

    await waitFor(() => expect(screen.getByText('+ Add "brandnewitem"')).toBeInTheDocument())

    await user.keyboard('{Enter}')

    expect(onCreateNew).toHaveBeenCalledOnce()
    expect(onCreateNew).toHaveBeenCalledWith('brandnewitem')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
