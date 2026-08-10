package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"groceries/models"
)

// ── test helpers ──────────────────────────────────────────────────────────────

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = d.Close() })
	return d
}

// testTimestamp returns a deterministic RFC3339 timestamp unique per second offset.
func testTimestamp(sec int) string {
	return time.Date(2026, 8, 9, 10, 0, sec, 0, time.UTC).Format(time.RFC3339)
}

// makeEvent builds a models.Event; lamport also selects a unique timestamp.
func makeEvent(id, typeStr, entityID, payload string, lamport int) models.Event {
	return models.Event{
		ID:        id,
		ClientID:  "client-test",
		Lamport:   lamport,
		Timestamp: testTimestamp(lamport),
		EntityID:  entityID,
		Type:      typeStr,
		Payload:   json.RawMessage(payload),
	}
}

// parseAnyTime is tolerant of the storage format the implementer picks for
// DATETIME columns (RFC3339, with/without offset, space vs T separator).
func parseAnyTime(t *testing.T, s string) time.Time {
	t.Helper()
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	} {
		if v, err := time.Parse(layout, s); err == nil {
			return v
		}
	}
	t.Fatalf("cannot parse time %q", s)
	return time.Time{}
}

func eventTime(t *testing.T, e models.Event) time.Time {
	t.Helper()
	return parseAnyTime(t, e.Timestamp)
}

func assertEqualTime(t *testing.T, want, got time.Time, msg string) {
	t.Helper()
	if !want.Equal(got) {
		t.Errorf("%s: want %v, got %v", msg, want, got)
	}
}

func queryInt(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var v int
	require.NoError(t, d.QueryRow(q, args...).Scan(&v), "query: %s", q)
	return v
}

func queryFloat(t *testing.T, d *sql.DB, q string, args ...any) float64 {
	t.Helper()
	var v float64
	require.NoError(t, d.QueryRow(q, args...).Scan(&v), "query: %s", q)
	return v
}

func queryString(t *testing.T, d *sql.DB, q string, args ...any) string {
	t.Helper()
	var v string
	require.NoError(t, d.QueryRow(q, args...).Scan(&v), "query: %s", q)
	return v
}

func queryTime(t *testing.T, d *sql.DB, q string, args ...any) time.Time {
	t.Helper()
	return parseAnyTime(t, queryString(t, d, q, args...))
}

func queryNullableTime(t *testing.T, d *sql.DB, q string, args ...any) (time.Time, bool) {
	t.Helper()
	var v sql.NullString
	require.NoError(t, d.QueryRow(q, args...).Scan(&v), "query: %s", q)
	if !v.Valid {
		return time.Time{}, false
	}
	return parseAnyTime(t, v.String), true
}

func rowCount(t *testing.T, d *sql.DB, table, where string, args ...any) int {
	t.Helper()
	return queryInt(t, d, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", table, where), args...)
}

func eventIDs(evs []models.Event) []string {
	ids := make([]string, len(evs))
	for i, e := range evs {
		ids[i] = e.ID
	}
	return ids
}

// ── event log: InsertEvents / GetEventsSince / LastSeq ────────────────────────

func TestInsertEventsReturnsAcceptedCountAndDedupesByID(t *testing.T) {
	d := openTestDB(t)
	e1 := makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1)
	e2 := makeEvent("e2", "ShopCreated", "shop-2", `{"name":"Lidl","color":"#0f0"}`, 2)

	n, err := InsertEvents(d, e1, e2)
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	n, err = InsertEvents(d, e1) // duplicate id
	require.NoError(t, err)
	assert.Equal(t, 0, n, "re-inserting an existing event id must be a duplicate")

	events, err := GetEventsSince(d, 0, 0)
	require.NoError(t, err)
	require.Len(t, events, 2, "log contains each event id exactly once")
	assert.Equal(t, []string{"e1", "e2"}, eventIDs(events))
	assert.Equal(t, e1.ID, events[0].ID)
	assert.Equal(t, e1.ClientID, events[0].ClientID)
	assert.Equal(t, e1.Lamport, events[0].Lamport)
	assert.Equal(t, e1.Timestamp, events[0].Timestamp)
	assert.Equal(t, e1.EntityID, events[0].EntityID)
	assert.Equal(t, e1.Type, events[0].Type)
	assert.JSONEq(t, string(e1.Payload), string(events[0].Payload))
}

func TestGetEventsSinceOrderingAndLimit(t *testing.T) {
	d := openTestDB(t)
	_, err := InsertEvents(d,
		makeEvent("e1", "ShopCreated", "s1", `{"name":"A","color":"#1"}`, 1),
		makeEvent("e2", "ShopCreated", "s2", `{"name":"B","color":"#2"}`, 2),
		makeEvent("e3", "ShopCreated", "s3", `{"name":"C","color":"#3"}`, 3),
	)
	require.NoError(t, err)

	all, err := GetEventsSince(d, 0, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{"e1", "e2", "e3"}, eventIDs(all))

	afterFirst, err := GetEventsSince(d, 1, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{"e2", "e3"}, eventIDs(afterFirst))

	limited, err := GetEventsSince(d, 1, 1)
	require.NoError(t, err)
	assert.Equal(t, []string{"e2"}, eventIDs(limited))

	afterLast, err := GetEventsSince(d, 3, 0)
	require.NoError(t, err)
	assert.Empty(t, afterLast)
}

func TestGetEventsSinceExposesServerSeq(t *testing.T) {
	d := openTestDB(t)
	_, err := InsertEvents(d,
		makeEvent("e1", "ShopCreated", "s1", `{"name":"A","color":"#1"}`, 1),
		makeEvent("e2", "ShopCreated", "s2", `{"name":"B","color":"#2"}`, 2),
		makeEvent("e3", "ShopCreated", "s3", `{"name":"C","color":"#3"}`, 3),
	)
	require.NoError(t, err)

	all, err := GetEventsSince(d, 0, 0)
	require.NoError(t, err)
	require.Len(t, all, 3)
	assert.Equal(t, []int64{1, 2, 3}, []int64{all[0].Seq, all[1].Seq, all[2].Seq},
		"events carry their server-assigned seq in insert order")

	fromSeq2, err := GetEventsSince(d, 2, 0)
	require.NoError(t, err)
	require.Len(t, fromSeq2, 1)
	assert.Equal(t, int64(3), fromSeq2[0].Seq)
}

func TestLastSeq(t *testing.T) {
	d := openTestDB(t)
	seq, err := LastSeq(d)
	require.NoError(t, err)
	assert.Equal(t, int64(0), seq, "empty log reports seq 0")

	_, err = InsertEvents(d,
		makeEvent("e1", "ShopCreated", "s1", `{"name":"A","color":"#1"}`, 1),
		makeEvent("e2", "ShopCreated", "s2", `{"name":"B","color":"#2"}`, 2),
		makeEvent("e3", "ShopCreated", "s3", `{"name":"C","color":"#3"}`, 3),
	)
	require.NoError(t, err)
	seq, err = LastSeq(d)
	require.NoError(t, err)
	assert.Equal(t, int64(3), seq)
}

// ── projections: ApplyEvent for each event type ──────────────────────────────

func TestApplyShopEvents(t *testing.T) {
	d := openTestDB(t)

	created := makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#ff0000"}`, 1)
	require.NoError(t, ApplyEvent(d, created))
	assert.Equal(t, "Biedronka", queryString(t, d, `SELECT name FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, "#ff0000", queryString(t, d, `SELECT color FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT updated_at FROM shops WHERE id = 'shop-1'`), "updated_at after create")

	renamed := makeEvent("e2", "ShopRenamed", "shop-1", `{"name":"Aldi"}`, 2)
	require.NoError(t, ApplyEvent(d, renamed))
	assert.Equal(t, "Aldi", queryString(t, d, `SELECT name FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, "#ff0000", queryString(t, d, `SELECT color FROM shops WHERE id = 'shop-1'`), "untouched fields survive rename")
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))
	assertEqualTime(t, eventTime(t, renamed), queryTime(t, d, `SELECT updated_at FROM shops WHERE id = 'shop-1'`), "updated_at after rename")

	color := makeEvent("e3", "ShopColorChanged", "shop-1", `{"color":"#00ff00"}`, 3)
	require.NoError(t, ApplyEvent(d, color))
	assert.Equal(t, "#00ff00", queryString(t, d, `SELECT color FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, "Aldi", queryString(t, d, `SELECT name FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, 3, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))

	deleted := makeEvent("e4", "ShopSoftDeleted", "shop-1", `{"deletedAt":"2026-08-09T12:00:00Z"}`, 4)
	require.NoError(t, ApplyEvent(d, deleted))
	delAt, ok := queryNullableTime(t, d, `SELECT deleted_at FROM shops WHERE id = 'shop-1'`)
	require.True(t, ok)
	assertEqualTime(t, parseAnyTime(t, "2026-08-09T12:00:00Z"), delAt, "deleted_at")
	assert.Equal(t, 4, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))
}

func TestApplyTagEvents(t *testing.T) {
	d := openTestDB(t)

	require.NoError(t, ApplyEvent(d, makeEvent("e1", "TagCreated", "tag-1", `{"name":"Urgent"}`, 1)))
	assert.Equal(t, "Urgent", queryString(t, d, `SELECT name FROM tags WHERE id = 'tag-1'`))

	require.NoError(t, ApplyEvent(d, makeEvent("e2", "TagDeleted", "tag-1", `{}`, 2)))
	assert.Zero(t, rowCount(t, d, "tags", "id = 'tag-1'"), "TagDeleted removes the tag")
}

func TestApplyItemEvents(t *testing.T) {
	d := openTestDB(t)

	created := makeEvent("e1", "ItemCreated", "item-1",
		`{"name":"Milk","unit":"L","defaultQuantity":2,"description":"dairy","notes":"cold"}`, 1)
	require.NoError(t, ApplyEvent(d, created))
	assert.Equal(t, "Milk", queryString(t, d, `SELECT name FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "L", queryString(t, d, `SELECT unit FROM items WHERE id = 'item-1'`))
	assert.Equal(t, 2.0, queryFloat(t, d, `SELECT default_quantity FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "dairy", queryString(t, d, `SELECT description FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "cold", queryString(t, d, `SELECT notes FROM items WHERE id = 'item-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM items WHERE id = 'item-1'`))
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT created_at FROM items WHERE id = 'item-1'`), "created_at")
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT updated_at FROM items WHERE id = 'item-1'`), "updated_at")

	updated := makeEvent("e2", "ItemUpdated", "item-1", `{"name":"Skimmed Milk","notes":"low fat"}`, 2)
	require.NoError(t, ApplyEvent(d, updated))
	assert.Equal(t, "Skimmed Milk", queryString(t, d, `SELECT name FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "low fat", queryString(t, d, `SELECT notes FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "L", queryString(t, d, `SELECT unit FROM items WHERE id = 'item-1'`), "unit untouched by partial update")
	assert.Equal(t, "dairy", queryString(t, d, `SELECT description FROM items WHERE id = 'item-1'`), "description untouched by partial update")
	assert.Equal(t, 2.0, queryFloat(t, d, `SELECT default_quantity FROM items WHERE id = 'item-1'`), "default_quantity untouched by partial update")
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM items WHERE id = 'item-1'`))
	assertEqualTime(t, eventTime(t, updated), queryTime(t, d, `SELECT updated_at FROM items WHERE id = 'item-1'`), "updated_at")
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT created_at FROM items WHERE id = 'item-1'`), "created_at unchanged")

	soft := makeEvent("e3", "ItemSoftDeleted", "item-1", `{"deletedAt":"2026-08-09T12:00:00Z"}`, 3)
	require.NoError(t, ApplyEvent(d, soft))
	delAt, ok := queryNullableTime(t, d, `SELECT deleted_at FROM items WHERE id = 'item-1'`)
	require.True(t, ok)
	assertEqualTime(t, parseAnyTime(t, "2026-08-09T12:00:00Z"), delAt, "deleted_at")
	assert.Equal(t, 3, queryInt(t, d, `SELECT version FROM items WHERE id = 'item-1'`))
}

func TestApplyItemLinkEvents(t *testing.T) {
	d := openTestDB(t)

	require.NoError(t, ApplyEvent(d, makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1)))
	require.NoError(t, ApplyEvent(d, makeEvent("e2", "TagCreated", "tag-1", `{"name":"Urgent"}`, 2)))
	require.NoError(t, ApplyEvent(d, makeEvent("e3", "ItemCreated", "item-1", `{"name":"Milk"}`, 3)))

	require.NoError(t, ApplyEvent(d, makeEvent("e4", "ShopAssignedToItem", "item-1", `{"shopId":"shop-1"}`, 4)))
	require.NoError(t, ApplyEvent(d, makeEvent("e5", "ShopAssignedToItem", "item-1", `{"shopId":"shop-1"}`, 5))) // dup
	assert.Equal(t, 1, rowCount(t, d, "item_shops", "item_id = 'item-1' AND shop_id = 'shop-1'"), "assignment dedupes")

	require.NoError(t, ApplyEvent(d, makeEvent("e6", "TagAssignedToItem", "item-1", `{"tagId":"tag-1"}`, 6)))
	require.NoError(t, ApplyEvent(d, makeEvent("e7", "TagAssignedToItem", "item-1", `{"tagId":"tag-1"}`, 7))) // dup
	assert.Equal(t, 1, rowCount(t, d, "item_tags", "item_id = 'item-1' AND tag_id = 'tag-1'"), "tag assignment dedupes")

	require.NoError(t, ApplyEvent(d, makeEvent("e8", "ShopRemovedFromItem", "item-1", `{"shopId":"shop-1"}`, 8)))
	assert.Zero(t, rowCount(t, d, "item_shops", "item_id = 'item-1' AND shop_id = 'shop-1'"))

	require.NoError(t, ApplyEvent(d, makeEvent("e9", "TagRemovedFromItem", "item-1", `{"tagId":"tag-1"}`, 9)))
	assert.Zero(t, rowCount(t, d, "item_tags", "item_id = 'item-1' AND tag_id = 'tag-1'"))
}

func TestApplyListEvents(t *testing.T) {
	d := openTestDB(t)

	created := makeEvent("e1", "ListCreated", "list-1", `{"name":"Weekly"}`, 1)
	require.NoError(t, ApplyEvent(d, created))
	assert.Equal(t, "Weekly", queryString(t, d, `SELECT name FROM lists WHERE id = 'list-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM lists WHERE id = 'list-1'`))
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT created_at FROM lists WHERE id = 'list-1'`), "created_at")
	assertEqualTime(t, eventTime(t, created), queryTime(t, d, `SELECT updated_at FROM lists WHERE id = 'list-1'`), "updated_at")
	_, ok := queryNullableTime(t, d, `SELECT archived_at FROM lists WHERE id = 'list-1'`)
	assert.False(t, ok, "no archived_at after create")
	_, ok = queryNullableTime(t, d, `SELECT deleted_at FROM lists WHERE id = 'list-1'`)
	assert.False(t, ok, "no deleted_at after create")

	renamed := makeEvent("e2", "ListRenamed", "list-1", `{"name":"Monthly"}`, 2)
	require.NoError(t, ApplyEvent(d, renamed))
	assert.Equal(t, "Monthly", queryString(t, d, `SELECT name FROM lists WHERE id = 'list-1'`))
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM lists WHERE id = 'list-1'`))
	assertEqualTime(t, eventTime(t, renamed), queryTime(t, d, `SELECT updated_at FROM lists WHERE id = 'list-1'`), "updated_at")

	archived := makeEvent("e3", "ListArchived", "list-1", `{"archivedAt":"2026-08-09T12:00:00Z"}`, 3)
	require.NoError(t, ApplyEvent(d, archived))
	archAt, ok := queryNullableTime(t, d, `SELECT archived_at FROM lists WHERE id = 'list-1'`)
	require.True(t, ok)
	assertEqualTime(t, parseAnyTime(t, "2026-08-09T12:00:00Z"), archAt, "archived_at")
	assert.Equal(t, 3, queryInt(t, d, `SELECT version FROM lists WHERE id = 'list-1'`))

	unarchived := makeEvent("e4", "ListUnarchived", "list-1", `{}`, 4)
	require.NoError(t, ApplyEvent(d, unarchived))
	_, ok = queryNullableTime(t, d, `SELECT archived_at FROM lists WHERE id = 'list-1'`)
	assert.False(t, ok, "ListUnarchived clears archived_at")
	assert.Equal(t, 4, queryInt(t, d, `SELECT version FROM lists WHERE id = 'list-1'`))

	deleted := makeEvent("e5", "ListDeleted", "list-1", `{"deletedAt":"2026-08-09T13:00:00Z"}`, 5)
	require.NoError(t, ApplyEvent(d, deleted))
	delAt, ok := queryNullableTime(t, d, `SELECT deleted_at FROM lists WHERE id = 'list-1'`)
	require.True(t, ok)
	assertEqualTime(t, parseAnyTime(t, "2026-08-09T13:00:00Z"), delAt, "deleted_at")
	assert.Equal(t, 5, queryInt(t, d, `SELECT version FROM lists WHERE id = 'list-1'`))
}

func TestApplyListItemEvents(t *testing.T) {
	d := openTestDB(t)

	require.NoError(t, ApplyEvent(d, makeEvent("e1", "ListCreated", "list-1", `{"name":"Weekly"}`, 1)))
	require.NoError(t, ApplyEvent(d, makeEvent("e2", "ItemCreated", "item-1", `{"name":"Milk","unit":"L"}`, 2)))

	added := makeEvent("e3", "ListItemAdded", "li-1",
		`{"listId":"list-1","itemId":"item-1","state":"active","quantity":2,"unit":"L","notes":"n"}`, 3)
	require.NoError(t, ApplyEvent(d, added))
	assert.Equal(t, "list-1", queryString(t, d, `SELECT list_id FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, "item-1", queryString(t, d, `SELECT item_id FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, "active", queryString(t, d, `SELECT state FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, 2.0, queryFloat(t, d, `SELECT quantity FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, "L", queryString(t, d, `SELECT unit FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, "n", queryString(t, d, `SELECT notes FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM list_items WHERE id = 'li-1'`))
	assertEqualTime(t, eventTime(t, added), queryTime(t, d, `SELECT added_at FROM list_items WHERE id = 'li-1'`), "added_at")
	assertEqualTime(t, eventTime(t, added), queryTime(t, d, `SELECT updated_at FROM list_items WHERE id = 'li-1'`), "updated_at")

	state := makeEvent("e4", "ListItemStateChanged", "li-1", `{"state":"bought"}`, 4)
	require.NoError(t, ApplyEvent(d, state))
	assert.Equal(t, "bought", queryString(t, d, `SELECT state FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM list_items WHERE id = 'li-1'`))
	assertEqualTime(t, eventTime(t, state), queryTime(t, d, `SELECT updated_at FROM list_items WHERE id = 'li-1'`), "updated_at")

	qty := makeEvent("e5", "ListItemQuantityChanged", "li-1", `{"quantity":5,"unit":"pcs"}`, 5)
	require.NoError(t, ApplyEvent(d, qty))
	assert.Equal(t, 5.0, queryFloat(t, d, `SELECT quantity FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, "pcs", queryString(t, d, `SELECT unit FROM list_items WHERE id = 'li-1'`))
	assert.Equal(t, 3, queryInt(t, d, `SELECT version FROM list_items WHERE id = 'li-1'`))

	require.NoError(t, ApplyEvent(d, makeEvent("e6", "ListItemRemoved", "li-1", `{}`, 6)))
	assert.Zero(t, rowCount(t, d, "list_items", "id = 'li-1'"), "ListItemRemoved removes the row")
}

func TestApplySkippedShopEvents(t *testing.T) {
	d := openTestDB(t)

	require.NoError(t, ApplyEvent(d, makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1)))
	require.NoError(t, ApplyEvent(d, makeEvent("e2", "ListCreated", "list-1", `{"name":"Weekly"}`, 2)))
	require.NoError(t, ApplyEvent(d, makeEvent("e3", "ItemCreated", "item-1", `{"name":"Milk"}`, 3)))
	require.NoError(t, ApplyEvent(d, makeEvent("e4", "ListItemAdded", "li-1",
		`{"listId":"list-1","itemId":"item-1","state":"active"}`, 4)))

	skip := makeEvent("e5", "ShopSkippedForListItem", "li-1", `{"shopId":"shop-1"}`, 5)
	require.NoError(t, ApplyEvent(d, skip))
	require.NoError(t, ApplyEvent(d, makeEvent("e6", "ShopSkippedForListItem", "li-1", `{"shopId":"shop-1"}`, 6))) // dup
	assert.Equal(t, 1, rowCount(t, d, "list_item_skipped_shops", "list_item_id = 'li-1' AND shop_id = 'shop-1'"), "skip dedupes")
	skipAt, ok := queryNullableTime(t, d, `SELECT skipped_at FROM list_item_skipped_shops WHERE list_item_id = 'li-1' AND shop_id = 'shop-1'`)
	require.True(t, ok)
	assertEqualTime(t, eventTime(t, skip), skipAt, "skipped_at")

	require.NoError(t, ApplyEvent(d, makeEvent("e7", "ShopSkipCleared", "li-1", `{"shopId":"shop-1"}`, 7)))
	assert.Zero(t, rowCount(t, d, "list_item_skipped_shops", "list_item_id = 'li-1' AND shop_id = 'shop-1'"), "ShopSkipCleared removes the row")
}

func TestApplySessionEvents(t *testing.T) {
	d := openTestDB(t)

	require.NoError(t, ApplyEvent(d, makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1)))
	require.NoError(t, ApplyEvent(d, makeEvent("e2", "ListCreated", "list-1", `{"name":"Weekly"}`, 2)))
	require.NoError(t, ApplyEvent(d, makeEvent("e3", "ItemCreated", "item-1", `{"name":"Milk"}`, 3)))

	started := makeEvent("e4", "ShoppingSessionStarted", "sess-1", `{"listId":"list-1","shopId":"shop-1"}`, 4)
	require.NoError(t, ApplyEvent(d, started))
	assert.Equal(t, "list-1", queryString(t, d, `SELECT list_id FROM shopping_sessions WHERE id = 'sess-1'`))
	assert.Equal(t, "shop-1", queryString(t, d, `SELECT shop_id FROM shopping_sessions WHERE id = 'sess-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM shopping_sessions WHERE id = 'sess-1'`))
	assertEqualTime(t, eventTime(t, started), queryTime(t, d, `SELECT started_at FROM shopping_sessions WHERE id = 'sess-1'`), "started_at")

	bought := makeEvent("e5", "SessionItemBought", "sess-1", `{"itemId":"item-1","quantity":3,"unit":"L"}`, 5)
	require.NoError(t, ApplyEvent(d, bought))
	assert.Equal(t, "sess-1", queryString(t, d, `SELECT session_id FROM session_items WHERE session_id = 'sess-1'`))
	assert.Equal(t, "item-1", queryString(t, d, `SELECT item_id FROM session_items WHERE session_id = 'sess-1'`))
	assert.Equal(t, "bought", queryString(t, d, `SELECT action FROM session_items WHERE session_id = 'sess-1'`))
	assert.Equal(t, 3.0, queryFloat(t, d, `SELECT quantity FROM session_items WHERE session_id = 'sess-1'`))
	assert.Equal(t, "L", queryString(t, d, `SELECT unit FROM session_items WHERE session_id = 'sess-1'`))
	assertEqualTime(t, eventTime(t, bought), queryTime(t, d, `SELECT at FROM session_items WHERE session_id = 'sess-1'`), "at")

	require.NoError(t, ApplyEvent(d, makeEvent("e6", "SessionItemSkipped", "sess-1", `{"itemId":"item-1"}`, 6)))
	assert.Equal(t, 2, rowCount(t, d, "session_items", "session_id = 'sess-1'"))
	assert.Equal(t, "skipped", queryString(t, d, `SELECT action FROM session_items WHERE session_id = 'sess-1' AND action = 'skipped'`))
}

func TestApplyBugReported(t *testing.T) {
	d := openTestDB(t)

	reported := makeEvent("e1", "BugReported", "bug-1", `{"text":"App crashes on load"}`, 1)
	require.NoError(t, ApplyEvent(d, reported))
	assert.Equal(t, "bug-1", queryString(t, d, `SELECT id FROM bug_reports WHERE id = 'bug-1'`))
	assert.Equal(t, "App crashes on load", queryString(t, d, `SELECT text FROM bug_reports WHERE id = 'bug-1'`))
	assertEqualTime(t, eventTime(t, reported), queryTime(t, d, `SELECT created_at FROM bug_reports WHERE id = 'bug-1'`), "created_at")
}

// ── replay ────────────────────────────────────────────────────────────────────

func TestReplayAllAppliesLogInOrder(t *testing.T) {
	d := openTestDB(t)

	_, err := InsertEvents(d,
		makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1),
		makeEvent("e2", "ShopRenamed", "shop-1", `{"name":"Aldi"}`, 2),
		makeEvent("e3", "ItemCreated", "item-1", `{"name":"Milk"}`, 3),
		makeEvent("e4", "ListCreated", "list-1", `{"name":"Weekly"}`, 4),
	)
	require.NoError(t, err)

	require.NoError(t, ReplayAll(d))
	assert.Equal(t, "Aldi", queryString(t, d, `SELECT name FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))
	assert.Equal(t, "Milk", queryString(t, d, `SELECT name FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "Weekly", queryString(t, d, `SELECT name FROM lists WHERE id = 'list-1'`))
}

func TestDuplicateReinsertDoesNotDoubleApply(t *testing.T) {
	d := openTestDB(t)

	e1 := makeEvent("e1", "ShopCreated", "shop-1", `{"name":"Biedronka","color":"#f00"}`, 1)
	e2 := makeEvent("e2", "ShopRenamed", "shop-1", `{"name":"Aldi"}`, 2)
	require.NoError(t, ApplyEvent(d, e1))
	require.NoError(t, ApplyEvent(d, e2))
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`))

	n, err := InsertEvents(d, e1, e2)
	require.NoError(t, err)
	assert.Equal(t, 0, n, "duplicate events must be rejected")

	last, err := LastSeq(d)
	require.NoError(t, err)
	assert.Equal(t, int64(2), last)

	newEvents, err := GetEventsSince(d, last, 0)
	require.NoError(t, err)
	assert.Empty(t, newEvents, "no new events to replay")
	for _, e := range newEvents {
		require.NoError(t, ApplyEvent(d, e))
	}
	assert.Equal(t, 2, queryInt(t, d, `SELECT version FROM shops WHERE id = 'shop-1'`), "version must not double-apply")

	all, err := GetEventsSince(d, 0, 0)
	require.NoError(t, err)
	assert.Len(t, all, 2, "log holds each event id exactly once")
}
