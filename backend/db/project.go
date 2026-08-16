package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"groceries/models"
)

// ApplyEvent records the event in the append-only log and projects it onto
// the relational tables in one transaction, mirroring the TS applyEvent
// semantics in frontend/src/api/client.ts.
func ApplyEvent(db *sql.DB, e models.Event) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO events(id, client_id, type, entity_id, payload, timestamp, lamport, received_at)
		 VALUES(?,?,?,?,?,?,?,?)`,
		e.ID, e.ClientID, e.Type, e.EntityID, string(e.Payload), e.Timestamp, e.Lamport, receivedAt,
	); err != nil {
		return err
	}

	if err := projectEvent(tx, e); err != nil {
		return err
	}
	return tx.Commit()
}

func projectEvent(tx *sql.Tx, e models.Event) error {
	switch e.Type {
	case models.EventShopCreated:
		var p struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO shops(id, name, color, version, updated_at) VALUES(?,?,?,1,?)`,
			e.EntityID, p.Name, p.Color, e.Timestamp,
		)
		return err

	case models.EventShopRenamed:
		var p struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "shops", []string{"name=?"}, []any{p.Name}, e)

	case models.EventShopColorChanged:
		var p struct {
			Color string `json:"color"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "shops", []string{"color=?"}, []any{p.Color}, e)

	case models.EventShopSoftDeleted:
		var p struct {
			DeletedAt string `json:"deletedAt"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "shops", []string{"deleted_at=?"}, []any{p.DeletedAt}, e)

	case models.EventTagCreated:
		var p struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO tags(id, name) VALUES(?,?)`, e.EntityID, p.Name)
		return err

	case models.EventTagDeleted:
		_, err := tx.Exec(`DELETE FROM tags WHERE id=?`, e.EntityID)
		return err

	case models.EventItemCreated:
		var p struct {
			Name            string   `json:"name"`
			Unit            *string  `json:"unit"`
			DefaultQuantity *float64 `json:"defaultQuantity"`
			Description     *string  `json:"description"`
			Notes           *string  `json:"notes"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO items(id, name, unit, default_quantity, description, notes, version, created_at, updated_at)
			 VALUES(?,?,?,?,?,?,1,?,?)`,
			e.EntityID, p.Name, p.Unit, p.DefaultQuantity, p.Description, p.Notes, e.Timestamp, e.Timestamp,
		)
		return err

	case models.EventOneTimeItemCreated:
		var p struct {
			Name            string   `json:"name"`
			Unit            *string  `json:"unit"`
			DefaultQuantity *float64 `json:"defaultQuantity"`
			Description     *string  `json:"description"`
			Notes           *string  `json:"notes"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO items(id, name, unit, default_quantity, description, notes, version, created_at, updated_at)
			 VALUES(?,?,?,?,?,?,1,?,?)`,
			e.EntityID, p.Name, p.Unit, p.DefaultQuantity, p.Description, p.Notes, e.Timestamp, e.Timestamp,
		); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO one_time_items(item_id) VALUES(?)`, e.EntityID)
		return err

	case models.EventItemUpdated:
		var p struct {
			Name            *string  `json:"name"`
			Unit            *string  `json:"unit"`
			DefaultQuantity *float64 `json:"defaultQuantity"`
			Description     *string  `json:"description"`
			Notes           *string  `json:"notes"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		sets := []string{}
		args := []any{}
		if p.Name != nil {
			sets = append(sets, "name=?")
			args = append(args, *p.Name)
		}
		if p.Unit != nil {
			sets = append(sets, "unit=?")
			args = append(args, *p.Unit)
		}
		if p.DefaultQuantity != nil {
			sets = append(sets, "default_quantity=?")
			args = append(args, *p.DefaultQuantity)
		}
		if p.Description != nil {
			sets = append(sets, "description=?")
			args = append(args, *p.Description)
		}
		if p.Notes != nil {
			sets = append(sets, "notes=?")
			args = append(args, *p.Notes)
		}
		return applyUpdate(tx, "items", sets, args, e)

	case models.EventItemSoftDeleted:
		var p struct {
			DeletedAt string `json:"deletedAt"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "items", []string{"deleted_at=?"}, []any{p.DeletedAt}, e)

	case models.EventShopAssignedToItem:
		var p struct {
			ShopID string `json:"shopId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT OR IGNORE INTO item_shops(item_id, shop_id) VALUES(?,?)`, e.EntityID, p.ShopID)
		return err

	case models.EventShopRemovedFromItem:
		var p struct {
			ShopID string `json:"shopId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM item_shops WHERE item_id=? AND shop_id=?`, e.EntityID, p.ShopID)
		return err

	case models.EventTagAssignedToItem:
		var p struct {
			TagID string `json:"tagId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?,?)`, e.EntityID, p.TagID)
		return err

	case models.EventTagRemovedFromItem:
		var p struct {
			TagID string `json:"tagId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM item_tags WHERE item_id=? AND tag_id=?`, e.EntityID, p.TagID)
		return err

	case models.EventListCreated:
		var p struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO lists(id, name, version, created_at, updated_at) VALUES(?,?,1,?,?)`,
			e.EntityID, p.Name, e.Timestamp, e.Timestamp,
		)
		return err

	case models.EventListRenamed:
		var p struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "lists", []string{"name=?"}, []any{p.Name}, e)

	case models.EventListArchived:
		var p struct {
			ArchivedAt string `json:"archivedAt"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "lists", []string{"archived_at=?"}, []any{p.ArchivedAt}, e)

	case models.EventListUnarchived:
		return applyUpdate(tx, "lists", []string{"archived_at=NULL"}, nil, e)

	case models.EventListDeleted:
		var p struct {
			DeletedAt string `json:"deletedAt"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "lists", []string{"deleted_at=?"}, []any{p.DeletedAt}, e)

	case models.EventListItemAdded:
		var p struct {
			ListID   string   `json:"listId"`
			ItemID   string   `json:"itemId"`
			State    string   `json:"state"`
			Quantity *float64 `json:"quantity"`
			Unit     *string  `json:"unit"`
			Notes    *string  `json:"notes"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO list_items(id, list_id, item_id, state, quantity, unit, notes, version, added_at, updated_at)
			 VALUES(?,?,?,?,?,?,?,1,?,?)`,
			e.EntityID, p.ListID, p.ItemID, p.State, p.Quantity, p.Unit, p.Notes, e.Timestamp, e.Timestamp,
		)
		return err

	case models.EventListItemStateChanged:
		var p struct {
			State string `json:"state"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		return applyUpdate(tx, "list_items", []string{"state=?"}, []any{p.State}, e)

	case models.EventListItemQuantityChanged:
		var p struct {
			Quantity *float64 `json:"quantity"`
			Unit     *string  `json:"unit"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		sets := []string{}
		args := []any{}
		if p.Quantity != nil {
			sets = append(sets, "quantity=?")
			args = append(args, *p.Quantity)
		}
		if p.Unit != nil {
			sets = append(sets, "unit=?")
			args = append(args, *p.Unit)
		}
		return applyUpdate(tx, "list_items", sets, args, e)

	case models.EventListItemRemoved:
		_, err := tx.Exec(`DELETE FROM list_items WHERE id=?`, e.EntityID)
		return err

	case models.EventShopSkippedForListItem:
		var p struct {
			ShopID string `json:"shopId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT OR IGNORE INTO list_item_skipped_shops(list_item_id, shop_id, skipped_at) VALUES(?,?,?)`,
			e.EntityID, p.ShopID, e.Timestamp,
		)
		return err

	case models.EventShopSkipCleared:
		var p struct {
			ShopID string `json:"shopId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM list_item_skipped_shops WHERE list_item_id=? AND shop_id=?`, e.EntityID, p.ShopID)
		return err

	case models.EventShoppingSessionStarted:
		var p struct {
			ListID string `json:"listId"`
			ShopID string `json:"shopId"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO shopping_sessions(id, list_id, shop_id, started_at, version) VALUES(?,?,?,?,1)`,
			e.EntityID, p.ListID, p.ShopID, e.Timestamp,
		)
		return err

	case models.EventSessionItemBought, models.EventSessionItemSkipped:
		var p struct {
			ItemID   string   `json:"itemId"`
			Quantity *float64 `json:"quantity"`
			Unit     *string  `json:"unit"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		action := "bought"
		if e.Type == models.EventSessionItemSkipped {
			action = "skipped"
		}
		_, err := tx.Exec(
			`INSERT INTO session_items(id, session_id, item_id, action, quantity, unit, at)
			 VALUES(?,?,?,?,?,?,?)`,
			e.ID, e.EntityID, p.ItemID, action, p.Quantity, p.Unit, e.Timestamp,
		)
		return err

	case models.EventBugReported:
		var p struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO bug_reports(id, text, created_at) VALUES(?,?,?)`,
			e.EntityID, p.Text, e.Timestamp,
		)
		return err

	default:
		return fmt.Errorf("projectEvent: unknown event type %q", e.Type)
	}
}

// applyUpdate merges the given SET columns onto an existing row, bumping
// version and updating updated_at. A missing row is a silent no-op (mirroring
// the TS mutate helper).
func applyUpdate(tx *sql.Tx, table string, sets []string, args []any, e models.Event) error {
	if len(sets) == 0 {
		return nil
	}
	q := fmt.Sprintf(`UPDATE %s SET %s, version = version + 1, updated_at = ? WHERE id = ?`,
		table, strings.Join(sets, ", "))
	args = append(args, e.Timestamp, e.EntityID)
	_, err := tx.Exec(q, args...)
	return err
}
