package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type bugReport struct {
	ID         string  `json:"id"`
	Text       string  `json:"text"`
	CreatedAt  string  `json:"created_at"`
	ResolvedAt *string `json:"resolved_at"`
}

func ListBugReports(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(),
			`SELECT id, text, created_at, resolved_at FROM bug_reports ORDER BY created_at DESC`,
		)
		if err != nil {
			log.Printf("ERROR list bug reports: %v", err)
			jsonError(w, "failed to list bug reports", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		reports := make([]bugReport, 0)
		for rows.Next() {
			var br bugReport
			var resolvedAt sql.NullString
			if err := rows.Scan(&br.ID, &br.Text, &br.CreatedAt, &resolvedAt); err != nil {
				log.Printf("ERROR scan bug report: %v", err)
				jsonError(w, "failed to read bug reports", http.StatusInternalServerError)
				return
			}
			if resolvedAt.Valid {
				br.ResolvedAt = &resolvedAt.String
			}
			reports = append(reports, br)
		}
		if err := rows.Err(); err != nil {
			log.Printf("ERROR iterate bug reports: %v", err)
			jsonError(w, "failed to read bug reports", http.StatusInternalServerError)
			return
		}

		jsonOK(w, reports)
	}
}

func ResolveBugReport(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		now := time.Now().UTC().Format(time.RFC3339)
		result, err := db.ExecContext(r.Context(),
			`UPDATE bug_reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`,
			now, id,
		)
		if err != nil {
			log.Printf("ERROR resolve bug report: %v", err)
			jsonError(w, "failed to resolve bug report", http.StatusInternalServerError)
			return
		}

		rows, err := result.RowsAffected()
		if err != nil {
			log.Printf("ERROR resolve bug report rows affected: %v", err)
			jsonError(w, "failed to resolve bug report", http.StatusInternalServerError)
			return
		}

		if rows == 0 {
			// Either not found or already resolved — check which
			var exists int
			if scanErr := db.QueryRowContext(r.Context(),
				`SELECT COUNT(*) FROM bug_reports WHERE id = ?`, id,
			).Scan(&exists); scanErr != nil || exists == 0 {
				jsonError(w, "bug report not found", http.StatusNotFound)
				return
			}
			// Already resolved — idempotent success
		}

		jsonOK(w, map[string]string{"id": id})
	}
}
