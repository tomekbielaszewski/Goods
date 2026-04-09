package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type reportBugRequest struct {
	Text string `json:"text"`
}

func ReportBug(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req reportBugRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request", http.StatusBadRequest)
			return
		}
		if req.Text == "" {
			jsonError(w, "text is required", http.StatusBadRequest)
			return
		}

		id := randomUUID()
		now := time.Now().UTC().Format(time.RFC3339)
		_, err := db.Exec(
			`INSERT INTO bug_reports (id, text, created_at) VALUES (?, ?, ?)`,
			id, req.Text, now,
		)
		if err != nil {
			log.Printf("ERROR report bug: %v", err)
			jsonError(w, "failed to save bug report", http.StatusInternalServerError)
			return
		}

		jsonOK(w, map[string]string{"id": id})
	}
}

func randomUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
