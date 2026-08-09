package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

func TestPublish_SingleEvent(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	e := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "Corner", "color": "red"})
	pr := doPublish(t, srv, e)

	require.Equal(t, 1, pr.Accepted)
	require.Equal(t, 0, pr.Duplicates)
	require.Equal(t, int64(1), pr.LastSeq)
}

func TestPublish_Batch(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	events := []models.Event{
		makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"}),
		makeEvent(t, models.EventShopCreated, "shop-2", map[string]any{"name": "B", "color": "blue"}),
		makeEvent(t, models.EventShopCreated, "shop-3", map[string]any{"name": "C", "color": "green"}),
	}
	pr := doPublish(t, srv, events...)

	require.Equal(t, 3, pr.Accepted)
	require.Equal(t, 0, pr.Duplicates)
	require.Equal(t, int64(3), pr.LastSeq)
}

func TestPublish_DuplicateWithinRequest(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	e := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"})
	pr := doPublish(t, srv, e, e)

	require.Equal(t, 1, pr.Accepted)
	require.Equal(t, 1, pr.Duplicates)
	require.Equal(t, int64(1), pr.LastSeq)
}

func TestPublish_SameEventAcrossRequestsDoesNotDoubleApply(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	e := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"})

	first := doPublish(t, srv, e)
	require.Equal(t, 1, first.Accepted)

	second := doPublish(t, srv, e)
	require.Equal(t, 0, second.Accepted)
	require.Equal(t, 1, second.Duplicates)
	require.Equal(t, int64(1), second.LastSeq, "re-publishing a known id must not grow the log")

	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM shops`).Scan(&count))
	require.Equal(t, 1, count, "duplicate event must not be applied twice to projections")
}

func TestPublish_InvalidEventRejected(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	invalid := []models.Event{
		// Unknown type
		makeEvent(t, "NoSuchEvent", "e-1", map[string]any{}),
		// Empty entityId
		{ID: "evt-x1", ClientID: "test-client", Lamport: 1, Timestamp: "2026-08-09T10:00:00Z", EntityID: "", Type: models.EventShopCreated, Payload: json.RawMessage(`{"name":"A","color":"red"}`)},
		// Negative lamport
		{ID: "evt-x2", ClientID: "test-client", Lamport: -1, Timestamp: "2026-08-09T10:00:00Z", EntityID: "shop-1", Type: models.EventShopCreated, Payload: json.RawMessage(`{"name":"A","color":"red"}`)},
	}

	for _, e := range invalid {
		t.Run(e.Type, func(t *testing.T) {
			status, body := postEvents(t, srv, e)
			require.Equal(t, http.StatusBadRequest, status, "body: %s", body)

			var errBody map[string]any
			require.NoError(t, json.Unmarshal(body, &errBody))
			require.Contains(t, errBody, "error", "error body must carry an error key")

			resp := doGetEvents(t, srv, 0, 0)
			require.Empty(t, resp.Events, "rejected events must not be persisted")
			require.Equal(t, int64(0), resp.LastSeq)
		})
	}
}

func TestPublish_MalformedJSON(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	resp, err := http.Post(srv.URL+"/api/events", "application/json", bytes.NewReader([]byte(`{not json`)))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	var errBody map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&errBody))
	require.Contains(t, errBody, "error")

	er := doGetEvents(t, srv, 0, 0)
	require.Empty(t, er.Events)
	require.Equal(t, int64(0), er.LastSeq)
}
