package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	appdb "grocery/db"
	"grocery/handlers"
	"grocery/models"
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

// newTestServer wires up the two API routes against the given database and
// returns an httptest.Server. The server is closed automatically when the
// test finishes.
func newTestServer(t *testing.T, database *sql.DB) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/api/bootstrap", handlers.Bootstrap(database))
	r.Post("/api/sync", handlers.Sync(database))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// doSync sends a POST /api/sync request and decodes the response into
// models.SyncResponse.
func doSync(t *testing.T, srv *httptest.Server, req models.SyncRequest) models.SyncResponse {
	t.Helper()
	body, err := json.Marshal(req)
	require.NoError(t, err)

	resp, err := http.Post(srv.URL+"/api/sync", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var syncResp models.SyncResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&syncResp))
	return syncResp
}

// doBootstrap sends a GET /api/bootstrap request and decodes the response.
func doBootstrap(t *testing.T, srv *httptest.Server) models.BootstrapResponse {
	t.Helper()
	resp, err := http.Get(srv.URL + "/api/bootstrap")
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var br models.BootstrapResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&br))
	return br
}
