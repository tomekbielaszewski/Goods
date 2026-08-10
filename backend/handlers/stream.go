package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	appdb "groceries/db"
	"groceries/models"
)

// StreamEvents handles GET /api/events/stream as a server-sent-events
// stream. If the `since` query parameter is present, events with seq >
// since are replayed first as catch-up frames (read from the log, never via
// the hub). Afterwards the client is subscribed to the hub and live events
// are forwarded until the connection closes.
//
// The subscription is registered before headers or catch-up frames are
// written so a live event arriving mid-handshake is buffered instead of
// lost. Each event is one `data:` line; there is no event: line, no trailing
// blank line, and no periodic heartbeat.
func StreamEvents(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			jsonError(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		// Subscribe before writing anything: a live event that lands
		// between here and the catch-up replay is buffered in the
		// channel and delivered right after the catch-up frames.
		events := hub.Subscribe()
		defer hub.Unsubscribe(events)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)

		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		if since < 0 {
			since = 0
		}
		catchUp, err := appdb.GetEventsSince(db, since, 0)
		if err != nil {
			log.Printf("ERROR stream catch-up: %v", err)
			return
		}
		for _, e := range catchUp {
			writeEventFrame(w, e)
		}
		flusher.Flush()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case e, ok := <-events:
				if !ok {
					return
				}
				writeEventFrame(w, e)
				flusher.Flush()
			}
		}
	}
}

func writeEventFrame(w http.ResponseWriter, e models.Event) {
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n", b)
}
