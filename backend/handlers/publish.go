package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	appdb "groceries/db"
	"groceries/models"
)

// PublishResponse is the JSON body of a successful POST /api/events.
type PublishResponse struct {
	Accepted   int   `json:"accepted"`
	Duplicates int   `json:"duplicates"`
	LastSeq    int64 `json:"lastSeq"`
}

// PublishEvents handles POST /api/events. The body is either a raw JSON
// array of events or an object {"events": [...]}. All events are validated
// up front — any invalid event rejects the whole request with 400 and
// nothing is persisted. Accepted events are appended to the log, projected
// onto the relational tables, and finally broadcast to SSE subscribers.
func PublishEvents(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var raw json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			jsonError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
			return
		}

		var events []models.Event
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) > 0 && trimmed[0] == '[' {
			if err := json.Unmarshal(trimmed, &events); err != nil {
				jsonError(w, "invalid events payload: "+err.Error(), http.StatusBadRequest)
				return
			}
		} else {
			var wrapper struct {
				Events []models.Event `json:"events"`
			}
			if err := json.Unmarshal(trimmed, &wrapper); err != nil {
				jsonError(w, "invalid events payload: "+err.Error(), http.StatusBadRequest)
				return
			}
			events = wrapper.Events
		}

		for _, e := range events {
			if err := e.Validate(); err != nil {
				jsonError(w, err.Error(), http.StatusBadRequest)
				return
			}
		}

		// Determine which events are genuinely new before inserting: check
		// the log for each unique id up front, then append and project only
		// those. A repeated id inside one request, or one already in the
		// log, must not re-run its projection.
		var newEvents []models.Event
		seen := make(map[string]bool)
		for _, e := range events {
			if seen[e.ID] {
				continue
			}
			seen[e.ID] = true
			alreadyStored, err := eventExists(db, e.ID)
			if err != nil {
				log.Printf("ERROR publish check event %s: %v", e.ID, err)
				jsonError(w, "failed to check event", http.StatusInternalServerError)
				return
			}
			if !alreadyStored {
				newEvents = append(newEvents, e)
			}
		}

		accepted, err := appdb.InsertEvents(db, events...)
		if err != nil {
			log.Printf("ERROR publish insert events: %v", err)
			jsonError(w, "failed to record events", http.StatusInternalServerError)
			return
		}

		for _, e := range newEvents {
			if err := appdb.ApplyEvent(db, e); err != nil {
				log.Printf("ERROR publish apply event %s: %v", e.ID, err)
				jsonError(w, "failed to apply event", http.StatusInternalServerError)
				return
			}
		}

		lastSeq, err := appdb.LastSeq(db)
		if err != nil {
			log.Printf("ERROR publish last seq: %v", err)
			jsonError(w, "failed to read log position", http.StatusInternalServerError)
			return
		}

		// Broadcast only after the commit so subscribers never see an
		// event whose projection they cannot read back yet.
		for _, e := range newEvents {
			hub.Publish(e)
		}

		jsonOK(w, PublishResponse{
			Accepted:   accepted,
			Duplicates: len(events) - accepted,
			LastSeq:    lastSeq,
		})
	}
}

func eventExists(db *sql.DB, id string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM events WHERE id = ?`, id).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
