package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"grocery/handlers"
)

func newTestServerWithBugReports(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	database := newTestDB(t)
	r := chi.NewRouter()
	r.Post("/api/report-bug", handlers.ReportBug(database))
	r.Get("/api/bug-reports", handlers.ListBugReports(database))
	r.Post("/api/bug-reports/{id}/resolve", handlers.ResolveBugReport(database))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, database
}

func TestListBugReports_Empty(t *testing.T) {
	srv, _ := newTestServerWithBugReports(t)

	resp, err := http.Get(srv.URL + "/api/bug-reports")
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	require.Len(t, result, 0)
}

func TestListBugReports_ReturnsSaved(t *testing.T) {
	srv, _ := newTestServerWithBugReports(t)

	// Submit two bugs
	postBug(t, srv, "crash on startup")
	postBug(t, srv, "wrong total price")

	resp, err := http.Get(srv.URL + "/api/bug-reports")
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	require.Len(t, result, 2)

	texts := []string{result[0]["text"].(string), result[1]["text"].(string)}
	require.Contains(t, texts, "crash on startup")
	require.Contains(t, texts, "wrong total price")
}

func TestListBugReports_HasRequiredFields(t *testing.T) {
	srv, _ := newTestServerWithBugReports(t)

	postBug(t, srv, "some bug")

	resp, err := http.Get(srv.URL + "/api/bug-reports")
	require.NoError(t, err)
	defer resp.Body.Close()

	var result []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	require.Len(t, result, 1)

	entry := result[0]
	require.NotEmpty(t, entry["id"])
	require.Equal(t, "some bug", entry["text"])
	require.NotEmpty(t, entry["created_at"])
	_, hasResolvedAt := entry["resolved_at"]
	require.True(t, hasResolvedAt, "resolved_at field must be present")
}

func TestResolveBugReport_Success(t *testing.T) {
	srv, db := newTestServerWithBugReports(t)

	id := postBug(t, srv, "button not working")

	resp, err := http.Post(fmt.Sprintf("%s/api/bug-reports/%s/resolve", srv.URL, id), "application/json", nil)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Verify resolved_at is set in DB
	var resolvedAt sql.NullString
	require.NoError(t, db.QueryRow(`SELECT resolved_at FROM bug_reports WHERE id = ?`, id).Scan(&resolvedAt))
	require.True(t, resolvedAt.Valid, "resolved_at should be set after resolving")
	require.NotEmpty(t, resolvedAt.String)
}

func TestResolveBugReport_NotFound(t *testing.T) {
	srv, _ := newTestServerWithBugReports(t)

	resp, err := http.Post(srv.URL+"/api/bug-reports/nonexistent-id/resolve", "application/json", nil)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestResolveBugReport_AlreadyResolved(t *testing.T) {
	srv, _ := newTestServerWithBugReports(t)

	id := postBug(t, srv, "some bug")

	// Resolve once
	resp1, err := http.Post(fmt.Sprintf("%s/api/bug-reports/%s/resolve", srv.URL, id), "application/json", nil)
	require.NoError(t, err)
	resp1.Body.Close()
	require.Equal(t, http.StatusOK, resp1.StatusCode)

	// Resolve again — should still succeed (idempotent)
	resp2, err := http.Post(fmt.Sprintf("%s/api/bug-reports/%s/resolve", srv.URL, id), "application/json", nil)
	require.NoError(t, err)
	resp2.Body.Close()
	require.Equal(t, http.StatusOK, resp2.StatusCode)
}

// postBug is a helper that submits a bug report and returns the new bug ID.
func postBug(t *testing.T, srv *httptest.Server, text string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"text": text})
	resp, err := http.Post(srv.URL+"/api/report-bug", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var result map[string]string
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	return result["id"]
}
