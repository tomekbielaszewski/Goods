package handlers_test

// Bug reports are now event-driven: a BugReported event is published through
// POST /api/events and projected onto the bug_reports table. The report id is
// the event's entityId. There is no dedicated report-bug endpoint anymore.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

type bugReportJSON struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	CreatedAt  string `json:"created_at"`
	ResolvedAt *string `json:"resolved_at"`
}

func getBugReports(t *testing.T, srv *httptest.Server) []bugReportJSON {
	t.Helper()
	resp, err := http.Get(srv.URL + "/api/bug-reports")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var out []bugReportJSON
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func publishBugReport(t *testing.T, srv *httptest.Server, id, text string) {
	t.Helper()
	e := makeEvent(t, models.EventBugReported, id, map[string]any{"text": text})
	doPublish(t, srv, e)
}

func resolveBugReport(t *testing.T, srv *httptest.Server, id string) int {
	t.Helper()
	resp, err := http.Post(fmt.Sprintf("%s/api/bug-reports/%s/resolve", srv.URL, id), "application/json", nil)
	require.NoError(t, err)
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestListBugReports_Empty(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	require.Empty(t, getBugReports(t, srv))
}

func TestListBugReports_FromEvents(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	publishBugReport(t, srv, "bug-1", "crash on startup")

	reports := getBugReports(t, srv)
	require.Equal(t, 1, len(reports))

	r := reports[0]
	require.Equal(t, "bug-1", r.ID, "bug report id must be the BugReported event's entityId")
	require.Equal(t, "crash on startup", r.Text)
	require.NotEmpty(t, r.CreatedAt)
	require.Nil(t, r.ResolvedAt, "unresolved report must have resolved_at: null")
}

func TestListBugReports_TwoEvents(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	publishBugReport(t, srv, "bug-1", "crash on startup")
	publishBugReport(t, srv, "bug-2", "wrong total price")

	reports := getBugReports(t, srv)
	require.Equal(t, 2, len(reports))

	texts := []string{reports[0].Text, reports[1].Text}
	require.Contains(t, texts, "crash on startup")
	require.Contains(t, texts, "wrong total price")
}

func TestResolveBugReport_Success(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	publishBugReport(t, srv, "bug-1", "crash on startup")

	require.Equal(t, http.StatusOK, resolveBugReport(t, srv, "bug-1"))

	reports := getBugReports(t, srv)
	require.Equal(t, 1, len(reports))
	require.NotNil(t, reports[0].ResolvedAt, "resolved_at must be non-null after resolving")
	require.NotEmpty(t, *reports[0].ResolvedAt)
}

func TestResolveBugReport_NotFound(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	require.Equal(t, http.StatusNotFound, resolveBugReport(t, srv, "nonexistent-id"))
}

func TestResolveBugReport_Twice(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	publishBugReport(t, srv, "bug-1", "crash on startup")

	require.Equal(t, http.StatusOK, resolveBugReport(t, srv, "bug-1"))
	require.Equal(t, http.StatusOK, resolveBugReport(t, srv, "bug-1"))
}
