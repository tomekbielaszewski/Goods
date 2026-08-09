package models

import (
	"encoding/json"
	"fmt"
)

// Event type constants mirroring frontend/src/types/event.ts (AppEvent union).
const (
	EventShopCreated             = "ShopCreated"
	EventShopRenamed             = "ShopRenamed"
	EventShopColorChanged        = "ShopColorChanged"
	EventShopSoftDeleted         = "ShopSoftDeleted"
	EventTagCreated              = "TagCreated"
	EventTagDeleted              = "TagDeleted"
	EventItemCreated             = "ItemCreated"
	EventItemUpdated             = "ItemUpdated"
	EventItemSoftDeleted         = "ItemSoftDeleted"
	EventShopAssignedToItem      = "ShopAssignedToItem"
	EventShopRemovedFromItem     = "ShopRemovedFromItem"
	EventTagAssignedToItem       = "TagAssignedToItem"
	EventTagRemovedFromItem      = "TagRemovedFromItem"
	EventListCreated             = "ListCreated"
	EventListRenamed             = "ListRenamed"
	EventListArchived            = "ListArchived"
	EventListUnarchived          = "ListUnarchived"
	EventListDeleted             = "ListDeleted"
	EventListItemAdded           = "ListItemAdded"
	EventListItemStateChanged    = "ListItemStateChanged"
	EventListItemQuantityChanged = "ListItemQuantityChanged"
	EventListItemRemoved         = "ListItemRemoved"
	EventShopSkippedForListItem  = "ShopSkippedForListItem"
	EventShopSkipCleared         = "ShopSkipCleared"
	EventShoppingSessionStarted  = "ShoppingSessionStarted"
	EventSessionItemBought       = "SessionItemBought"
	EventSessionItemSkipped      = "SessionItemSkipped"
	EventBugReported             = "BugReported"
)

// Event is the wire format of an append-only domain event, mirroring the
// AppEvent shape the frontend emits.
type Event struct {
	ID        string          `json:"id"`
	ClientID  string          `json:"clientId"`
	Lamport   int             `json:"lamport"`
	Timestamp string          `json:"timestamp"`
	EntityID  string          `json:"entityId"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

func IsValidEventType(t string) bool {
	switch t {
	case EventShopCreated,
		EventShopRenamed,
		EventShopColorChanged,
		EventShopSoftDeleted,
		EventTagCreated,
		EventTagDeleted,
		EventItemCreated,
		EventItemUpdated,
		EventItemSoftDeleted,
		EventShopAssignedToItem,
		EventShopRemovedFromItem,
		EventTagAssignedToItem,
		EventTagRemovedFromItem,
		EventListCreated,
		EventListRenamed,
		EventListArchived,
		EventListUnarchived,
		EventListDeleted,
		EventListItemAdded,
		EventListItemStateChanged,
		EventListItemQuantityChanged,
		EventListItemRemoved,
		EventShopSkippedForListItem,
		EventShopSkipCleared,
		EventShoppingSessionStarted,
		EventSessionItemBought,
		EventSessionItemSkipped,
		EventBugReported:
		return true
	}
	return false
}

func (e Event) Validate() error {
	if e.ID == "" {
		return fmt.Errorf("event: missing id")
	}
	if e.Type == "" {
		return fmt.Errorf("event: missing type")
	}
	if !IsValidEventType(e.Type) {
		return fmt.Errorf("event: unknown type %q", e.Type)
	}
	if e.EntityID == "" {
		return fmt.Errorf("event: missing entityId")
	}
	if e.Lamport < 0 {
		return fmt.Errorf("event: negative lamport %d", e.Lamport)
	}
	if e.Payload != nil && !json.Valid(e.Payload) {
		return fmt.Errorf("event: invalid payload JSON")
	}
	return nil
}
