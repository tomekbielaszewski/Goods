import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import ShopItemsScreen from './ShopItemsScreen'
import { apiClient } from '../api/client'
import type { Item, Shop, ItemShop, ItemTag, Tag } from '../types'

const store = apiClient as unknown as {
  shops: Map<string, Shop>
  items: Map<string, Item>
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  tags: Map<string, Tag>
}

const makeShop = (id: string, overrides: Partial<Shop> = {}): Shop => ({
  id, name: `Shop ${id}`, color: '#3b82f6', version: 1,
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeItem = (id: string, name: string, overrides: Partial<Item> = {}): Item => ({
  id, name, version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stubSyncFetch = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && u === '/api/events') {
      return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 1 })
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`)
  }))
}

const renderShopItems = (shopId: string) =>
  render(
    <MemoryRouter initialEntries={[`/shop/${shopId}`]}>
      <Routes>
        <Route path="/shop/:id" element={<ShopItemsScreen />} />
        <Route path="/settings" element={<div>settings screen</div>} />
      </Routes>
    </MemoryRouter>
  )

const section = (heading: string) =>
  within(screen.getByText(heading).closest('section')!)

beforeEach(() => {
  apiClient.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ShopItemsScreen — rendering', () => {
  it('renders the shop header with the item counter', async () => {
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderShopItems('s1')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Supermarket')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('splits items into the in-shop and not-in-shop sections', async () => {
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk', { unit: 'l' }))
    store.items.set('i2', makeItem('i2', 'Bread'))
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderShopItems('s1')

    expect(await screen.findByText('In this shop')).toBeInTheDocument()
    expect(section('In this shop').getByText('Milk')).toBeInTheDocument()
    expect(section('In this shop').getByText('l')).toBeInTheDocument()
    expect(section('Not in this shop').getByText('Bread')).toBeInTheDocument()
  })

  it('renders item tags', async () => {
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.itemTags.push({ itemId: 'i1', tagId: 't1' })

    renderShopItems('s1')

    expect(await screen.findByText('dairy')).toBeInTheDocument()
  })

  it('renders nothing when the shop does not exist', async () => {
    const { container } = renderShopItems('missing')
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })
})

describe('ShopItemsScreen — toggling items', () => {
  it('assigns an item to the shop and moves it between sections', async () => {
    const user = userEvent.setup()
    stubSyncFetch()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))

    renderShopItems('s1')

    await screen.findByText('Not in this shop')
    await user.click(section('Not in this shop').getByRole('button', { name: /Bread/ }))

    await waitFor(() => {
      expect(store.itemShops).toContainEqual({ itemId: 'i2', shopId: 's1' })
    })
    await waitFor(() => {
      expect(section('In this shop').getByText('Bread')).toBeInTheDocument()
    })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('removes an item from the shop when toggled off', async () => {
    const user = userEvent.setup()
    stubSyncFetch()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderShopItems('s1')

    await user.click(await screen.findByRole('button', { name: /Milk/ }))

    await waitFor(() => {
      expect(store.itemShops).toHaveLength(0)
    })
    await waitFor(() => {
      expect(section('Not in this shop').getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
  })
})

describe('ShopItemsScreen — filtering', () => {
  it('filters the list by the typed query', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderShopItems('s1')

    const input = await screen.findByPlaceholderText('Filter items…')
    await user.type(input, 'Milk')

    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.queryByText('Bread')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('shows the no-match message when nothing matches', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))

    renderShopItems('s1')

    const input = await screen.findByPlaceholderText('Filter items…')
    await user.type(input, 'zzzz')

    expect(await screen.findByText('No items match.')).toBeInTheDocument()
    expect(screen.queryByText('In this shop')).not.toBeInTheDocument()
  })

  it('matches accent-insensitively', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Żółw'))

    renderShopItems('s1')

    const input = await screen.findByPlaceholderText('Filter items…')
    await user.type(input, 'zolw')

    expect(await screen.findByText('Żółw')).toBeInTheDocument()
  })

  it('clearing the filter restores the full list', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))
    store.items.set('i1', makeItem('i1', 'Milk'))
    store.items.set('i2', makeItem('i2', 'Bread'))

    renderShopItems('s1')

    const input = await screen.findByPlaceholderText('Filter items…')
    await user.type(input, 'Milk')
    expect(screen.queryByText('Bread')).not.toBeInTheDocument()

    await user.clear(input)
    expect(await screen.findByText('Bread')).toBeInTheDocument()
  })
})

describe('ShopItemsScreen — navigation', () => {
  it('navigates back to settings', async () => {
    const user = userEvent.setup()
    store.shops.set('s1', makeShop('s1', { name: 'Supermarket' }))

    renderShopItems('s1')

    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Back to settings' }))
    expect(await screen.findByText('settings screen')).toBeInTheDocument()
  })
})
