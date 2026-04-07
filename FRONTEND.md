# Grocery App — Frontend Layout

## Views

### 1. Lists Screen *(home / entry point)*
All lists at a glance. Shows name, date created, item count. Actions: create, rename, duplicate, delete. Tap a list to open it.

### 2. List — Browse/Edit Mode *(default when opening a list)*
The management view. All items on the list visible regardless of skipped state. Active items on top, bought (crossed out) at bottom. Each item card shows coloured shop dots — dimmed/crossed for skipped shops. Sort toggle (date / name / frequency). Add items via search + suggestions panel. Button to enter Shopping Mode.

### 3. List — Shopping Mode *(activated from browse mode)*
Overlay/separate layout on the same list. User picks current shop. Only shows active items for that shop (skipped ones hidden). Compact, distraction-free. Tap = bought, swipe = "won't buy here". Bought items drift to bottom crossed out. Shop switcher to change shop mid-trip. Exit returns to browse mode.

### 4. Item Repository *(global catalog)*
Browse all items. Search/filter by name, tag, shop. Add, edit, delete items. Tap an item to open its detail.

### 5. Item Detail *(within repository)*
Full item fields: name, shops, unit, description, notes, tags. Stats section: times bought, last date, where bought, total amounts, full purchase history log. Edit from here.

### 6. Shop Manager *(settings area)*
Create, edit, delete shops. Name + colour picker per shop.

### 7. Conflict Review Screen *(triggered by notification)*
Non-blocking — accessed via a toast, not forced. List of conflicting entities. Side-by-side field diff. Per conflict: keep mine / use server / edit manually.

---

## Navigation Structure

```
Bottom nav (mobile-first):
  [Lists]   [Repository]   [Settings]

Lists
  └── List (browse/edit)
        └── Shopping Mode (same list, different layout)
              └── (exit → back to browse)

Repository
  └── Item Detail (slide in)

Settings
  ├── Shop Manager
  └── (Tags are inline everywhere, no dedicated screen needed)

Conflicts (toast → slide-in overlay, accessible from anywhere)
```

---

## Shared Components

| Component | Used in |
|-----------|---------|
| `ItemCard` | List browse, List shopping, Repository |
| `ShopDot` | ItemCard everywhere |
| `TagBadge` | ItemCard, Item Detail, filters |
| `SearchInput` + autocomplete | List browse (add items), Repository |
| `SuggestionsPanel` | List browse (add items) |
| `SortToggle` | List browse, Repository |
| `SyncStatusBar` | Persistent, always visible (tiny) |

---

## Key Dependencies / Things to Get Right Early

1. **ItemCard** is the most reused component — needs to support three contexts: repository (no state), browse mode (state + shop dots), shopping mode (compact, gesture-enabled)
2. **Browse ↔ Shopping Mode** share the same list data — they're two render modes of the same screen, not separate routes
3. **Dexie schema mirrors the SQL schema** — getting this right early means everything else is just queries
4. **SyncStatusBar** is persistent — lives outside the route tree
