package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	appdb "groceries/db"
	"groceries/handlers"
	"groceries/models"
)

// newTestDB opens an in-memory SQLite database, applies the schema, and
// registers a cleanup function to close it when the test finishes.
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := appdb.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return database
}

// newTestServer wires up the event-based API routes against the given
// database and hub, and returns an httptest.Server. The server is closed
// automatically when the test finishes.
func newTestServer(t *testing.T, database *sql.DB, hub *handlers.Hub) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/api/events", handlers.PublishEvents(database, hub))
	r.Get("/api/events", handlers.GetEvents(database))
	r.Get("/api/events/stream", handlers.StreamEvents(database, hub))
	r.Get("/api/bug-reports", handlers.ListBugReports(database))
	r.Post("/api/bug-reports/{id}/resolve", handlers.ResolveBugReport(database))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// PublishResponse is the JSON body of a successful POST /api/events.
type PublishResponse struct {
	Accepted   int   `json:"accepted"`
	Duplicates int   `json:"duplicates"`
	LastSeq    int64 `json:"lastSeq"`
}

// EventsResponse is the JSON body of GET /api/events.
type EventsResponse struct {
	Events  []models.Event `json:"events"`
	LastSeq int64          `json:"lastSeq"`
}

// doPublish posts the given events to /api/events and decodes the response.
func doPublish(t *testing.T, srv *httptest.Server, events ...models.Event) PublishResponse {
	t.Helper()
	status, body := postEvents(t, srv, events...)
	require.Equal(t, http.StatusOK, status, "POST /api/events failed: %s", body)

	var pr PublishResponse
	require.NoError(t, json.Unmarshal(body, &pr))
	return pr
}

// postEvents posts raw events to /api/events and returns the status code and
// body bytes without asserting on the status.
func postEvents(t *testing.T, srv *httptest.Server, events ...models.Event) (int, []byte) {
	t.Helper()
	payload, err := json.Marshal(events)
	require.NoError(t, err)
	resp, err := http.Post(srv.URL+"/api/events", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, body
}

// doGetEvents fetches /api/events?since=..&limit=.. and decodes the response.
// A limit <= 0 omits the limit parameter.
func doGetEvents(t *testing.T, srv *httptest.Server, since int64, limit int) EventsResponse {
	t.Helper()
	u, err := url.Parse(srv.URL + "/api/events")
	require.NoError(t, err)
	q := u.Query()
	q.Set("since", fmt.Sprintf("%d", since))
	if limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", limit))
	}
	u.RawQuery = q.Encode()

	resp, err := http.Get(u.String())
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var er EventsResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&er))
	return er
}

var makeEventCounter int64

// makeEvent builds a models.Event with a unique id and a fixed timestamp.
// Payload is optional: nil encodes to JSON null (use map[string]any{} when
// the event needs an empty object payload).
func makeEvent(t *testing.T, typ, entityID string, payload map[string]any) models.Event {
	t.Helper()
	var raw json.RawMessage
	if payload == nil {
		raw = json.RawMessage("null")
	} else {
		pb, err := json.Marshal(payload)
		require.NoError(t, err)
		raw = pb
	}
	n := atomic.AddInt64(&makeEventCounter, 1)
	return models.Event{
		ID:        fmt.Sprintf("evt-%d", n),
		ClientID:  "test-client",
		Lamport:   1,
		Timestamp: "2026-08-09T10:00:00Z",
		EntityID:  entityID,
		Type:      typ,
		Payload:   raw,
	}
}
