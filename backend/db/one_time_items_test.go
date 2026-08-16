package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// One-time items are real items (a row in `items`) that additionally carry a
// marker row in `one_time_items` so they are hidden from catalogue reads but
// stay renderable as list lines.

func TestApplyOneTimeItemCreatedProjectsItemAndMarker(t *testing.T) {
	d := openTestDB(t)

	created := makeEvent("e1", "OneTimeItemCreated", "item-1",
		`{"name":"Special Cheese","unit":"kg","defaultQuantity":1,"description":"aged","notes":"rare"}`, 1)
	require.NoError(t, ApplyEvent(d, created))

	// The item is fully real underneath.
	assert.Equal(t, "Special Cheese", queryString(t, d, `SELECT name FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "kg", queryString(t, d, `SELECT unit FROM items WHERE id = 'item-1'`))
	assert.Equal(t, 1.0, queryFloat(t, d, `SELECT default_quantity FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "aged", queryString(t, d, `SELECT description FROM items WHERE id = 'item-1'`))
	assert.Equal(t, "rare", queryString(t, d, `SELECT notes FROM items WHERE id = 'item-1'`))
	assert.Equal(t, 1, queryInt(t, d, `SELECT version FROM items WHERE id = 'item-1'`))

	// And it carries the one-time marker.
	assert.Equal(t, 1, rowCount(t, d, "one_time_items", "item_id = 'item-1'"))

	// Soft-deleting the item keeps the marker row: a bought/removed one-time
	// line must stay renderable on the list.
	require.NoError(t, ApplyEvent(d, makeEvent("e2", "ItemSoftDeleted", "item-1",
		`{"deletedAt":"2026-08-09T12:00:00Z"}`, 2)))
	assert.Equal(t, 1, rowCount(t, d, "one_time_items", "item_id = 'item-1'"))
}

func TestOneTimeItemCreatedReplayDoesNotDuplicate(t *testing.T) {
	d := openTestDB(t)

	e1 := makeEvent("e1", "OneTimeItemCreated", "item-1", `{"name":"Special Cheese"}`, 1)
	require.NoError(t, ApplyEvent(d, e1))
	assert.Equal(t, 1, rowCount(t, d, "one_time_items", "item_id = 'item-1'"))

	// Re-inserting the same event id must be a duplicate (no double projection).
	n, err := InsertEvents(d, e1)
	require.NoError(t, err)
	assert.Equal(t, 0, n, "duplicate event id must be rejected")

	last, err := LastSeq(d)
	require.NoError(t, err)
	assert.Equal(t, int64(1), last)

	newEvents, err := GetEventsSince(d, last, 0)
	require.NoError(t, err)
	assert.Empty(t, newEvents, "no new events to replay")

	for _, e := range newEvents {
		require.NoError(t, ApplyEvent(d, e))
	}
	assert.Equal(t, 1, rowCount(t, d, "items", "id = 'item-1'"))
	assert.Equal(t, 1, rowCount(t, d, "one_time_items", "item_id = 'item-1'"))
}
