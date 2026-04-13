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

	"groceries/handlers"
)

func newTestServerWithReport(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	database := newTestDB(t)
	r := chi.NewRouter()
	r.Post("/api/report-bug", handlers.ReportBug(database))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, database
}

func TestReportBug_Success(t *testing.T) {
	srv, db := newTestServerWithReport(t)

	body, _ := json.Marshal(map[string]string{"text": "app crashes on load"})
	resp, err := http.Post(srv.URL+"/api/report-bug", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]string
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	require.NotEmpty(t, result["id"])

	// Verify it was persisted in the DB
	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM bug_reports`).Scan(&count))
	require.Equal(t, 1, count)
}

func TestReportBug_EmptyText(t *testing.T) {
	srv, _ := newTestServerWithReport(t)

	body, _ := json.Marshal(map[string]string{"text": ""})
	resp, err := http.Post(srv.URL+"/api/report-bug", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestReportBug_InvalidJSON(t *testing.T) {
	srv, _ := newTestServerWithReport(t)

	resp, err := http.Post(srv.URL+"/api/report-bug", "application/json", bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}
