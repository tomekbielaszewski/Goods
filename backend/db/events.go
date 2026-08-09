package db

import (
	"database/sql"
	"fmt"
	"time"

	"groceries/models"
)

// InsertEvents appends the given events to the append-only log, deduping by
// event id (re-inserting an existing id is a no-op). Returns the number of
// events actually inserted.
func InsertEvents(db *sql.DB, events ...models.Event) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	accepted := 0
	for _, e := range events {
		res, err := tx.Exec(
			`INSERT OR IGNORE INTO events(id, client_id, type, entity_id, payload, timestamp, lamport, received_at)
			 VALUES(?,?,?,?,?,?,?,?)`,
			e.ID, e.ClientID, e.Type, e.EntityID, string(e.Payload), e.Timestamp, e.Lamport, receivedAt,
		)
		if err != nil {
			return 0, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, err
		}
		accepted += int(n)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return accepted, nil
}

// GetEventsSince returns events with seq greater than the given cursor,
// ordered by seq ascending. limit <= 0 means no limit.
func GetEventsSince(db *sql.DB, seq int64, limit int) ([]models.Event, error) {
	q := `SELECT id, client_id, type, entity_id, payload, timestamp, lamport FROM events WHERE seq > ? ORDER BY seq ASC`
	args := []any{seq}
	if limit > 0 {
		q += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []models.Event{}
	for rows.Next() {
		var e models.Event
		var clientID, entityID, typeStr string
		var payload []byte
		if err := rows.Scan(&e.ID, &clientID, &typeStr, &entityID, &payload, &e.Timestamp, &e.Lamport); err != nil {
			return nil, err
		}
		e.ClientID = clientID
		e.Type = typeStr
		e.EntityID = entityID
		e.Payload = payload
		events = append(events, e)
	}
	return events, rows.Err()
}

// LastSeq returns the highest seq in the log, or 0 for an empty log.
func LastSeq(db *sql.DB) (int64, error) {
	var seq int64
	if err := db.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM events`).Scan(&seq); err != nil {
		return 0, fmt.Errorf("last seq: %w", err)
	}
	return seq, nil
}

// ReplayAll applies the whole log to the projections in seq order.
func ReplayAll(db *sql.DB) error {
	events, err := GetEventsSince(db, 0, 0)
	if err != nil {
		return err
	}
	for _, e := range events {
		if err := ApplyEvent(db, e); err != nil {
			return fmt.Errorf("replay %s %q: %w", e.ID, e.Type, err)
		}
	}
	return nil
}
