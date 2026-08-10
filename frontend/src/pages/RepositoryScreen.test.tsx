import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom'
import RepositoryScreen from './RepositoryScreen'
import { apiClient } from '../api/client'
import type { Item, Shop, Tag, ItemShop, ItemTag } from '../types'

const store = apiClient as unknown as {
  items: Map<string, Item>
  shops: Map<string, Shop>
  tags: Map<string, Tag>
  itemShops: ItemShop[]
  itemTags: ItemTag[]
}

const makeItem = (id: string, name: string, overrides: Partial<Item> = {}): Item => ({
  id, name, version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeShop = (id: string, name: string): Shop => ({
  id, name, color: '#3b82f6', version: 1,
  updatedAt: new Date().toISOString(),
})

const NewItemProbe = () => {
  const location = useLocation()
  return <div>new item screen{location.search}</div>
}

const ItemProbe = () => {
  const { id } = useParams<{ id: string }>()
  return <div>item detail screen {id}</div>
}

const renderRepository = () =>
  render(
    <MemoryRouter initialEntries={['/repository']}>
      <Routes>
        <Route path="/repository" element={<RepositoryScreen />} />
        <Route path="/item/new" element={<NewItemProbe />} />
        <Route path="/item/:id" element={<ItemProbe />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  apiClient.reset()
})

describe('RepositoryScreen — rendering', () => {
  it('renders the catalog with item names, units, tags, shops and frequency', async () => {
    store.items.set('i1', makeItem('i1', 'Milk', { unit: 'l' }))
    store.items.set('i2', makeItem('i2', 'Bread'))
    store.shops.set('s1', makeShop('s1', 'Supermarket'))
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })
    store.itemTags.push({ itemId: 'i1', tagId: 't1' })

    renderRepository()

    expect(await screen.findByText('Milk')).toBeInTheDocument()
    expect(screen.getByText('Bread')).toBeInTheDocument()
    expect(screen.getByText('l')).toBeInTheDocument()
    expect(screen.getByText('dairy')).toBeInTheDocument()
    expect(screen.getByTitle('Supermarket')).toBeInTheDocument()
  })

  it('shows the empty state when there are no items', async () => {
    renderRepository()
    expect(await screen.findByText('No items yet. Add your first item!')).toBeInTheDocument()
  })
})

describe('RepositoryScreen — search', () => {
  it('filters the catalog by the typed query', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))

    renderRepository()

    await screen.findByText('Milk')
    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'Mil')

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
      expect(screen.queryByText('Bread')).not.toBeInTheDocument()
    })
  })

  it('shows the create button for a query that matches nothing exactly', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))

    renderRepository()

    await screen.findByText('Milk')
    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'zzz')

    expect(await screen.findByRole('button', { name: /Create "zzz"/ })).toBeInTheDocument()
  })

  it('does not show the create button when the query exactly matches an item', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))

    renderRepository()

    await screen.findByText('Milk')
    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'milk')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument()
    })
  })

  it('clearing the search restores the full catalog and hides the create button', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))

    renderRepository()

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Milk')
    await waitFor(() => {
      expect(screen.queryByText('Bread')).not.toBeInTheDocument()
    })
    await user.clear(input)

    expect(await screen.findByText('Bread')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument()
  })
})

describe('RepositoryScreen — navigation', () => {
  it('navigates to the new item form via the create button', async () => {
    const user = userEvent.setup()

    renderRepository()

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'zzz')
    await user.click(await screen.findByRole('button', { name: /Create "zzz"/ }))

    expect(await screen.findByText('new item screen?name=zzz')).toBeInTheDocument()
  })

  it('navigates to the new item form when Enter is pressed on a fresh query', async () => {
    const user = userEvent.setup()

    renderRepository()

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'abc{Enter}')

    expect(await screen.findByText('new item screen?name=abc')).toBeInTheDocument()
  })

  it('does not navigate on Enter when the query exactly matches an item', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))

    renderRepository()

    await screen.findByText('Milk')
    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'milk{Enter}')

    expect(screen.queryByText(/new item screen/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Item Catalog' })).toBeInTheDocument()
  })

  it('navigates to the item detail screen when an item card is clicked', async () => {
    const user = userEvent.setup()
    store.items.set('i1', makeItem('i1', 'Milk'))

    renderRepository()

    await user.click(await screen.findByText('Milk'))
    expect(await screen.findByText('item detail screen i1')).toBeInTheDocument()
  })

  it('navigates to the empty new item form via the bottom button', async () => {
    const user = userEvent.setup()

    renderRepository()

    await user.click(await screen.findByRole('button', { name: /^\+ New item$/ }))
    expect(await screen.findByText('new item screen')).toBeInTheDocument()
  })
})
