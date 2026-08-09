package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"

	appdb "groceries/db"
	"groceries/models"
)

// EventsResponse is the JSON body of GET /api/events.
type EventsResponse struct {
	Events  []models.Event `json:"events"`
	LastSeq int64          `json:"lastSeq"`
}

// GetEvents handles GET /api/events?since=<int>&limit=<int>. since defaults
// to 0 (the start of the log); limit defaults to 0, meaning unlimited.
func GetEvents(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		if since < 0 {
			since = 0
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit < 0 {
			limit = 0
		}

		events, err := appdb.GetEventsSince(db, since, limit)
		if err != nil {
			log.Printf("ERROR retrieve events: %v", err)
			jsonError(w, "failed to read events", http.StatusInternalServerError)
			return
		}
		if events == nil {
			events = []models.Event{}
		}

		lastSeq, err := appdb.LastSeq(db)
		if err != nil {
			log.Printf("ERROR retrieve last seq: %v", err)
			jsonError(w, "failed to read log position", http.StatusInternalServerError)
			return
		}

		jsonOK(w, EventsResponse{Events: events, LastSeq: lastSeq})
	}
}
