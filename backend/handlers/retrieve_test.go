package handlers_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

func TestGetEvents_Empty(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	er := doGetEvents(t, srv, 0, 0)

	require.Empty(t, er.Events)
	require.Equal(t, int64(0), er.LastSeq)
}

func TestGetEvents_ReturnsAllInSeqOrder(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	doPublish(t, srv,
		makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"}),
		makeEvent(t, models.EventShopCreated, "shop-2", map[string]any{"name": "B", "color": "blue"}),
		makeEvent(t, models.EventShopCreated, "shop-3", map[string]any{"name": "C", "color": "green"}),
	)

	er := doGetEvents(t, srv, 0, 0)

	require.Equal(t, 3, len(er.Events))
	require.Equal(t, int64(3), er.LastSeq)

	got := make([]string, 0, 3)
	for _, e := range er.Events {
		got = append(got, e.EntityID)
	}
	require.Equal(t, []string{"shop-1", "shop-2", "shop-3"}, got)
}

func TestGetEvents_Since(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	doPublish(t, srv,
		makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"}),
		makeEvent(t, models.EventShopCreated, "shop-2", map[string]any{"name": "B", "color": "blue"}),
		makeEvent(t, models.EventShopCreated, "shop-3", map[string]any{"name": "C", "color": "green"}),
	)

	er := doGetEvents(t, srv, 2, 0)

	require.Equal(t, 1, len(er.Events))
	require.Equal(t, "shop-3", er.Events[0].EntityID)
	require.Equal(t, int64(3), er.LastSeq)
}

func TestGetEvents_Limit(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	doPublish(t, srv,
		makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"}),
		makeEvent(t, models.EventShopCreated, "shop-2", map[string]any{"name": "B", "color": "blue"}),
		makeEvent(t, models.EventShopCreated, "shop-3", map[string]any{"name": "C", "color": "green"}),
	)

	er := doGetEvents(t, srv, 0, 1)

	require.Equal(t, 1, len(er.Events))
	require.Equal(t, "shop-1", er.Events[0].EntityID)
	require.Equal(t, int64(3), er.LastSeq, "lastSeq must reflect the full log, not the limited page")
}
