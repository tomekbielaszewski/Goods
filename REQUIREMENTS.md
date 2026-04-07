# Grocery App — Requirements

## Vision

A web-based grocery management app. After the initial page load no internet connection is required — all state lives in 
the browser (localStorage / IndexedDB). Single-user. Fast, compact, Material-inspired UI optimised for use on a phone while standing in a supermarket aisle.

---

## Core Concepts

### Item Repository

A single global catalog of all items. Items are permanent. Every list draws from this shared repository — there are no copies of items per list.

Each item stores:

| Field | Notes |
|-------|-------|
| Name | Required |
| Shops | Shops where this item can be bought (multi-select from user-defined shops) |
| Quantity | Numeric, optional (default amount to add) |
| Unit | Free text or pick-list (`kg`, `g`, `l`, `ml`, `pcs`, …) |
| Description | Optional short description |
| Notes / Comments | Optional free text |
| Tags | Multi-select, user-defined free-form labels (category, dietary, aisle hints, etc.) |
| Stats | See *Stats* section |

### Shops

Shops are a first-class concept. The user maintains a named list of shops (e.g. `Auchan`, `Frisco`, `Roadside veggies`). 
Each shop has a name and a display colour. Items are associated with one or more shops.

### Lists

A list is a named context that tracks the **state of each item within that context**. Lists are all equal — there is no 
"master list" or "one-time list" distinction. The user creates as many lists as needed.

A list has:
- Name
- Date created
- A set of item memberships, each carrying a per-item state (see below)

**Item state within a list:**

| State | Meaning |
|-------|---------|
| `active` | Needs to be bought on this list |
| `bought` | Checked off; purchased |
| `skipped(shop)` | Hidden for a specific shop in this list's shopping mode; still visible in browse mode |

An item not added to a list has no state in that list.

---

## Features

### 1. Item Repository View

- Browse all items; search and filter by name, tags, shops
- Open item detail to see full info and stats
- Add / edit / delete items
- No list-state shown here — this is pure catalog management

### 2. List Management

- Create, rename, delete, duplicate lists
- View all lists (name, date created, item count)
- Tap a list to open it

### 3. List — Browse / Edit Mode

The default mode when opening a list. Optimised for managing what's on the list.

**Display:**
- All items on the list are shown regardless of skipped state
- Each item card shows small coloured dots/circles representing the shops the item is associated with
- For shops that are currently `skipped` for this item in this list, the dot is visually distinct (crossed out or different fill/background)
- `bought` items are crossed out and sorted to the bottom

**Actions:**
- Add items to the list via search (by name, tag, or shop) or from the suggestions panel
- Remove items from the list
- Edit quantity/notes for this list context
- Reset a `bought` item to `active`
- Sort: by added date / by name / by frequency

**Adding items:**
- Search field with autocomplete from the full item repository (ranked by frequency)
- Suggestions panel showing frequently bought items not yet on this list
- Tap a suggested item to add it as `active`
- When the searched item cannot be found - open a dialog for adding the item to the catalog with that searched name

### 4. List — Shopping Mode

Activated by tapping **"Start shopping"** and selecting (or confirming) the current shop.

**Display:**
- Shows only `active` items associated with the selected shop (skipped items for that shop are hidden)
- `bought` items shown at bottom, crossed out
- Compact, tap-optimised layout

**Interactions:**

| Action | Control | Result |
|--------|---------|--------|
| Mark as bought | Tap item / checkbox | State → `bought`; moves to bottom, crossed out |
| Won't buy here | Swipe or button | State → `skipped(shop)`; hidden from current shop view |
| Undo bought | Tap crossed-out item | State → `active` |

**Switching shops mid-trip:** user can change the active shop; `skipped(shop)` items for the previous shop remain hidden, 
but items skipped for a *different* shop reappear.

**End shopping:** returns to browse mode; no automatic state changes.

### 5. Sorting

Available in both modes, togglable per list:

1. **By added date** (default — newest first)
2. **By name** (A → Z)
3. **By frequency** (most frequently bought first)

`active` items always appear above `bought` items regardless of sort.

### 6. Suggestions & Autocomplete

- **Autocomplete**: typing in the add-item field queries the item repository by name/tag/shop, ranked by purchase frequency
- **Suggestions panel**: top N frequently bought items not currently `active` on this list; one tap adds them

(Suggestion algorithm to be refined during implementation.)

### 7. Stats

Collected automatically; displayed only in the **item detail view** in the repository.

**Per item:**
- Total times bought (all lists)
- Last bought date and shop
- Purchase history log: `[{ date, list, shop, quantity, unit }]`
- Derived purchase frequency

**Per list (session log):**
- Each shopping trip records: date, shop, items bought (name, qty, unit), items skipped

---

## UI & UX

- **Style** — Material-inspired, dense/compact; minimal padding, no wasted whitespace
- **Two optimised modes per list** — browse/edit (information-rich) and shopping (tap-first, distraction-free)
- **Shop indicators** — small coloured circles on item cards; crossed or dimmed when skipped for a shop
- **Theme** — light / dark / auto (system preference)
- **Responsive** — optimised for mobile (375 px+); usable on desktop
- **Performance** — instant; no loading spinners for local-data operations
- **Offline** — fully functional after first page load

---

## Out of Scope (for now)

- GPS / location tracking
- PWA / installability
- Multi-user, sharing, or sync
- Price tracking
- Barcode scanning
- Photo attachments (notes cover the immediate need for now)
