package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"grocery/models"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func ptr[T any](v T) *T { return &v }

// emptyChanges returns a SyncChanges with all slices initialised to non-nil
// so JSON serialisation produces [] rather than null.
func emptyChanges() models.SyncChanges {
	return models.SyncChanges{
		Shops:                []models.Shop{},
		Items:                []models.Item{},
		Tags:                 []models.Tag{},
		ItemShops:            []models.ItemShop{},
		ItemTags:             []models.ItemTag{},
		Lists:                []models.List{},
		ListItems:            []models.ListItem{},
		ListItemSkippedShops: []models.ListItemSkippedShop{},
		ShoppingSessions:     []models.ShoppingSession{},
		SessionItems:         []models.SessionItem{},
	}
}

// syncRequest constructs a SyncRequest using the given lastSyncedAt and
// changes, filling in default empty slices where the caller left them nil.
func syncRequest(lastSyncedAt time.Time, changes models.SyncChanges) models.SyncRequest {
	return models.SyncRequest{
		LastSyncedAt: lastSyncedAt,
		Changes:      changes,
	}
}

// ---------------------------------------------------------------------------
// TestSync_EmptyPayload
// ---------------------------------------------------------------------------

func TestSync_EmptyPayload(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	req := syncRequest(time.Now().UTC().Add(-time.Hour), emptyChanges())
	resp := doSync(t, srv, req)

	assert.NotNil(t, resp.Applied)
	assert.NotNil(t, resp.Conflicts)
	assert.Empty(t, resp.Applied)
	assert.Empty(t, resp.Conflicts)

	// serverChanges collections must be present and empty.
	assert.NotNil(t, resp.ServerChanges.Shops)
	assert.NotNil(t, resp.ServerChanges.Items)
	assert.NotNil(t, resp.ServerChanges.Lists)
	assert.NotNil(t, resp.ServerChanges.ListItems)
	assert.Empty(t, resp.ServerChanges.Shops)
	assert.Empty(t, resp.ServerChanges.Items)
	assert.Empty(t, resp.ServerChanges.Lists)
	assert.Empty(t, resp.ServerChanges.ListItems)
}

// ---------------------------------------------------------------------------
// TestSync_NewShop
// ---------------------------------------------------------------------------

func TestSync_NewShop(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	shop := models.Shop{
		ID:        "shop-new-1",
		Name:      "Aldi",
		Color:     "#0000ff",
		Version:   1,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "shop-new-1", "new shop ID must appear in applied")
	assert.Empty(t, resp.Conflicts)

	// Verify the shop is visible in bootstrap.
	br := doBootstrap(t, srv)
	require.Len(t, br.Shops, 1)
	assert.Equal(t, "shop-new-1", br.Shops[0].ID)
	assert.Equal(t, "Aldi", br.Shops[0].Name)
	assert.Equal(t, "#0000ff", br.Shops[0].Color)
}

// ---------------------------------------------------------------------------
// TestSync_NewItem
// ---------------------------------------------------------------------------

func TestSync_NewItem(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	item := models.Item{
		ID:        "item-new-1",
		Name:      "Eggs",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "item-new-1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.Items, 1)
	assert.Equal(t, "Eggs", br.Items[0].Name)
}

// ---------------------------------------------------------------------------
// TestSync_NewList
// ---------------------------------------------------------------------------

func TestSync_NewList(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	list := models.List{
		ID:        "list-new-1",
		Name:      "Weekend Shop",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Lists = []models.List{list}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "list-new-1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.Lists, 1)
	assert.Equal(t, "Weekend Shop", br.Lists[0].Name)
}

// ---------------------------------------------------------------------------
// TestSync_NewListItem
// ---------------------------------------------------------------------------

func TestSync_NewListItem(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	shop := models.Shop{ID: "s1", Name: "Tesco", Color: "#red1", Version: 1, UpdatedAt: now}
	item := models.Item{ID: "i1", Name: "Bread", Version: 1, CreatedAt: now, UpdatedAt: now}
	list := models.List{ID: "l1", Name: "Daily", Version: 1, CreatedAt: now, UpdatedAt: now}
	listItem := models.ListItem{
		ID:        "li1",
		ListID:    "l1",
		ItemID:    "i1",
		State:     "active",
		Version:   1,
		AddedAt:   now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}
	changes.Items = []models.Item{item}
	changes.Lists = []models.List{list}
	changes.ListItems = []models.ListItem{listItem}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.Contains(t, resp.Applied, "s1")
	assert.Contains(t, resp.Applied, "i1")
	assert.Contains(t, resp.Applied, "l1")
	assert.Contains(t, resp.Applied, "li1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.ListItems, 1)
	assert.Equal(t, "li1", br.ListItems[0].ID)
	assert.Equal(t, "l1", br.ListItems[0].ListID)
	assert.Equal(t, "i1", br.ListItems[0].ItemID)
}

// ---------------------------------------------------------------------------
// TestSync_UpdateItem_ClientNewer
// ---------------------------------------------------------------------------

func TestSync_UpdateItem_ClientNewer(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	base := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	lastSync := base.Add(30 * time.Minute) // sync happened after the original insert
	clientUpdatedAt := lastSync.Add(10 * time.Minute)

	// Seed item v1 directly in the DB (simulates server state before client knew about update).
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-upd-1", "OldName", 1,
		base.Format(time.RFC3339Nano), base.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends v2 with a newer updatedAt.
	item := models.Item{
		ID:        "item-upd-1",
		Name:      "NewName",
		Version:   2,
		CreatedAt: base,
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	require.Contains(t, resp.Applied, "item-upd-1", "client-newer update must be applied")
	assert.Empty(t, resp.Conflicts)

	// DB must reflect the new name.
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-upd-1").Scan(&name))
	assert.Equal(t, "NewName", name)
}

// ---------------------------------------------------------------------------
// TestSync_UpdateItem_ServerNewer
// ---------------------------------------------------------------------------

func TestSync_UpdateItem_ServerNewer(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	base := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	lastSync := base.Add(30 * time.Minute)
	serverUpdatedAt := lastSync.Add(20 * time.Minute) // server updated after lastSync
	clientUpdatedAt := base.Add(10 * time.Minute)     // client updated BEFORE lastSync

	// Seed item with a newer server timestamp.
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-sv-1", "ServerName", 3,
		base.Format(time.RFC3339Nano), serverUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends an older version.
	item := models.Item{
		ID:        "item-sv-1",
		Name:      "ClientName",
		Version:   2,
		CreatedAt: base,
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.NotContains(t, resp.Applied, "item-sv-1", "server-newer item must NOT be applied")
	assert.Empty(t, resp.Conflicts)

	// DB must still have the server name.
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-sv-1").Scan(&name))
	assert.Equal(t, "ServerName", name)
}

// ---------------------------------------------------------------------------
// TestSync_Conflict
// ---------------------------------------------------------------------------

func TestSync_Conflict(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	serverUpdatedAt := lastSync.Add(5 * time.Minute)  // server changed after sync
	clientUpdatedAt := lastSync.Add(10 * time.Minute) // client also changed after sync

	// Seed the server version.
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-conflict-1", "ServerVersion", 2,
		lastSync.Add(-time.Hour).Format(time.RFC3339Nano),
		serverUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends its own version, also newer than lastSync → conflict.
	item := models.Item{
		ID:        "item-conflict-1",
		Name:      "ClientVersion",
		Version:   2,
		CreatedAt: lastSync.Add(-time.Hour),
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.NotContains(t, resp.Applied, "item-conflict-1", "conflicting item must NOT be in applied")
	require.Len(t, resp.Conflicts, 1, "exactly one conflict expected")
	assert.Equal(t, "item", resp.Conflicts[0].Entity)
	assert.Equal(t, "item-conflict-1", resp.Conflicts[0].ID)

	// Server payload must be present and valid JSON.
	var serverPayload map[string]any
	require.NoError(t, json.Unmarshal(resp.Conflicts[0].Server, &serverPayload))

	// DB must remain unchanged (server version wins in conflict — no write).
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-conflict-1").Scan(&name))
	assert.Equal(t, "ServerVersion", name)
}

// ---------------------------------------------------------------------------
// TestSync_ServerChanges
// ---------------------------------------------------------------------------

func TestSync_ServerChanges(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	seededAt := lastSync.Add(10 * time.Minute) // seeded after lastSync → must appear in serverChanges

	_, err := database.Exec(
		`INSERT INTO shops(id, name, color, version, updated_at) VALUES(?,?,?,?,?)`,
		"shop-srv-1", "Biedronka", "#cc0000", 1,
		seededAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	_, err = database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-srv-1", "Butter", 1,
		seededAt.Format(time.RFC3339Nano),
		seededAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	req := syncRequest(lastSync, emptyChanges())
	resp := doSync(t, srv, req)

	assert.Empty(t, resp.Applied)
	assert.Empty(t, resp.Conflicts)

	// Both seeded records should appear in serverChanges.
	shopIDs := make([]string, 0, len(resp.ServerChanges.Shops))
	for _, s := range resp.ServerChanges.Shops {
		shopIDs = append(shopIDs, s.ID)
	}
	assert.Contains(t, shopIDs, "shop-srv-1", "seeded shop must appear in serverChanges.shops")

	itemIDs := make([]string, 0, len(resp.ServerChanges.Items))
	for _, item := range resp.ServerChanges.Items {
		itemIDs = append(itemIDs, item.ID)
	}
	assert.Contains(t, itemIDs, "item-srv-1", "seeded item must appear in serverChanges.items")
}

// ---------------------------------------------------------------------------
// TestSync_InvalidJSON
// ---------------------------------------------------------------------------

func TestSync_InvalidJSON(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	resp, err := http.Post(
		srv.URL+"/api/sync",
		"application/json",
		bytes.NewBufferString(`{not valid json`),
	)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// ---------------------------------------------------------------------------
// TestSync_SkippedShops
// ---------------------------------------------------------------------------

func TestSync_SkippedShops(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	// Need the dependent rows to satisfy foreign-key constraints.
	shop := models.Shop{ID: "sk-shop-1", Name: "Skip Shop", Color: "#111", Version: 1, UpdatedAt: now}
	item := models.Item{ID: "sk-item-1", Name: "Skip Item", Version: 1, CreatedAt: now, UpdatedAt: now}
	list := models.List{ID: "sk-list-1", Name: "Skip List", Version: 1, CreatedAt: now, UpdatedAt: now}
	listItem := models.ListItem{
		ID: "sk-li-1", ListID: "sk-list-1", ItemID: "sk-item-1",
		State: "active", Version: 1, AddedAt: now, UpdatedAt: now,
	}
	skipped := models.ListItemSkippedShop{
		ListItemID: "sk-li-1",
		ShopID:     "sk-shop-1",
		SkippedAt:  now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}
	changes.Items = []models.Item{item}
	changes.Lists = []models.List{list}
	changes.ListItems = []models.ListItem{listItem}
	changes.ListItemSkippedShops = []models.ListItemSkippedShop{skipped}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.Empty(t, resp.Conflicts)
	assert.Contains(t, resp.Applied, "sk-shop-1")
	assert.Contains(t, resp.Applied, "sk-li-1")

	// Verify the skipped-shop appears in the subsequent bootstrap.
	br := doBootstrap(t, srv)
	require.Len(t, br.ListItemSkippedShops, 1)
	assert.Equal(t, "sk-li-1", br.ListItemSkippedShops[0].ListItemID)
	assert.Equal(t, "sk-shop-1", br.ListItemSkippedShops[0].ShopID)
}
