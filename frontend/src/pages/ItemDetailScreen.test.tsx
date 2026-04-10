import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ItemDetailScreen from './ItemDetailScreen'
import { db } from '../db/schema'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const renderNewItem = () =>
  render(
    <MemoryRouter initialEntries={['/item/new']}>
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(async () => {
  await db.transaction('rw', [db.tags, db.items, db.itemTags, db.shops, db.itemShops, db.lists, db.listItems, db.listItemSkippedShops, db.shoppingSessions, db.sessionItems, db.pendingSyncIds], async () => {
    await Promise.all([
      db.tags.clear(),
      db.items.clear(),
      db.itemTags.clear(),
      db.shops.clear(),
      db.itemShops.clear(),
      db.lists.clear(),
      db.listItems.clear(),
      db.listItemSkippedShops.clear(),
      db.shoppingSessions.clear(),
      db.sessionItems.clear(),
      db.pendingSyncIds.clear(),
    ])
  })
})

describe('ItemDetailScreen — tag filtering', () => {
  it('shows all existing tags when the input is empty', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
      { id: 't3', name: 'drinks' },
    ])

    renderNewItem()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ dairy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ drinks' })).toBeInTheDocument()
    })
  })

  it('filters the tag list as the user types', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
      { id: 't3', name: 'drinks' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dr')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ drinks' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ frozen' })).not.toBeInTheDocument()
    })
  })

  it('hides the list entirely when nothing matches', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'xyz')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^\+ / })).not.toBeInTheDocument()
    })
  })

  it('clicking a tag from the list adds it to selected tags', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const dairyBtn = await screen.findByRole('button', { name: '+ dairy' })
    await user.click(dairyBtn)

    await waitFor(() => {
      // Tag badge appears (selected state — rendered via TagBadge, no + prefix)
      expect(screen.getByText('dairy')).toBeInTheDocument()
      // The suggestion button is gone since the tag is now selected
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
    })
  })

  it('shows remaining unselected tags after one is selected', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const dairyBtn = await screen.findByRole('button', { name: '+ dairy' })
    await user.click(dairyBtn)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
    })
  })

  it('pressing Enter adds a new tag and clears the input', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'spicy')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('spicy')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })

  it('pressing Enter on a typed value that matches an existing tag selects it', async () => {
    await db.tags.add({ id: 't1', name: 'dairy' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dairy')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      // dairy badge rendered, not in suggestion list anymore
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
      expect(screen.getByText('dairy')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })
})
