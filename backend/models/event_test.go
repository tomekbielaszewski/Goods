package models

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// frontendEventTypes mirrors frontend/src/types/event.ts (AppEvent union) exactly.
var frontendEventTypes = []string{
	"ShopCreated",
	"ShopRenamed",
	"ShopColorChanged",
	"ShopSoftDeleted",
	"TagCreated",
	"TagDeleted",
	"ItemCreated",
	"ItemUpdated",
	"ItemSoftDeleted",
	"ShopAssignedToItem",
	"ShopRemovedFromItem",
	"TagAssignedToItem",
	"TagRemovedFromItem",
	"ListCreated",
	"ListRenamed",
	"ListArchived",
	"ListUnarchived",
	"ListDeleted",
	"ListItemAdded",
	"ListItemStateChanged",
	"ListItemQuantityChanged",
	"ListItemRemoved",
	"ShopSkippedForListItem",
	"ShopSkipCleared",
	"ShoppingSessionStarted",
	"SessionItemBought",
	"SessionItemSkipped",
	"BugReported",
}

func validEvent() Event {
	return Event{
		ID:        "evt-1",
		ClientID:  "client-7",
		Lamport:   42,
		Timestamp: "2026-08-09T10:00:00Z",
		EntityID:  "shop-1",
		Type:      "ShopCreated",
		Payload:   json.RawMessage(`{"name":"Biedronka","color":"#ff0000"}`),
	}
}

func TestEventJSONRoundTripPreservesAllFields(t *testing.T) {
	orig := validEvent()

	data, err := json.Marshal(orig)
	require.NoError(t, err)

	// Wire format uses the camelCase field names the frontend sends.
	var obj map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(data, &obj))
	for _, key := range []string{"id", "clientId", "lamport", "timestamp", "entityId", "type", "payload"} {
		assert.Contains(t, obj, key, "marshaled event must contain field %q", key)
	}

	var got Event
	require.NoError(t, json.Unmarshal(data, &got))
	assert.Equal(t, orig.ID, got.ID)
	assert.Equal(t, orig.ClientID, got.ClientID)
	assert.Equal(t, orig.Lamport, got.Lamport)
	assert.Equal(t, orig.Timestamp, got.Timestamp)
	assert.Equal(t, orig.EntityID, got.EntityID)
	assert.Equal(t, orig.Type, got.Type)
	assert.JSONEq(t, string(orig.Payload), string(got.Payload))
}

func TestEventUnmarshalFromClientWireShape(t *testing.T) {
	raw := `{
		"id": "e1",
		"clientId": "c1",
		"lamport": 5,
		"timestamp": "2026-08-09T10:00:00Z",
		"entityId": "item-9",
		"type": "ItemCreated",
		"payload": {"name": "Milk", "unit": "L"}
	}`
	var e Event
	require.NoError(t, json.Unmarshal([]byte(raw), &e))
	assert.Equal(t, "e1", e.ID)
	assert.Equal(t, "c1", e.ClientID)
	assert.Equal(t, 5, e.Lamport)
	assert.Equal(t, "2026-08-09T10:00:00Z", e.Timestamp)
	assert.Equal(t, "item-9", e.EntityID)
	assert.Equal(t, "ItemCreated", e.Type)
	assert.JSONEq(t, `{"name":"Milk","unit":"L"}`, string(e.Payload))
}

func TestEventTypeConstantsMatchFrontendTypeStrings(t *testing.T) {
	got := map[string]string{
		"ShopCreated":              EventShopCreated,
		"ShopRenamed":              EventShopRenamed,
		"ShopColorChanged":         EventShopColorChanged,
		"ShopSoftDeleted":          EventShopSoftDeleted,
		"TagCreated":               EventTagCreated,
		"TagDeleted":               EventTagDeleted,
		"ItemCreated":              EventItemCreated,
		"ItemUpdated":              EventItemUpdated,
		"ItemSoftDeleted":          EventItemSoftDeleted,
		"ShopAssignedToItem":       EventShopAssignedToItem,
		"ShopRemovedFromItem":      EventShopRemovedFromItem,
		"TagAssignedToItem":        EventTagAssignedToItem,
		"TagRemovedFromItem":       EventTagRemovedFromItem,
		"ListCreated":              EventListCreated,
		"ListRenamed":              EventListRenamed,
		"ListArchived":             EventListArchived,
		"ListUnarchived":           EventListUnarchived,
		"ListDeleted":              EventListDeleted,
		"ListItemAdded":            EventListItemAdded,
		"ListItemStateChanged":     EventListItemStateChanged,
		"ListItemQuantityChanged":  EventListItemQuantityChanged,
		"ListItemRemoved":          EventListItemRemoved,
		"ShopSkippedForListItem":   EventShopSkippedForListItem,
		"ShopSkipCleared":          EventShopSkipCleared,
		"ShoppingSessionStarted":   EventShoppingSessionStarted,
		"SessionItemBought":        EventSessionItemBought,
		"SessionItemSkipped":       EventSessionItemSkipped,
		"BugReported":              EventBugReported,
	}
	require.Len(t, got, len(frontendEventTypes), "one constant per frontend event type")
	for want := range got {
		assert.Equal(t, want, got[want], "constant for %q", want)
	}
}

func TestIsValidEventType(t *testing.T) {
	for _, et := range frontendEventTypes {
		assert.True(t, IsValidEventType(et), "expected %q to be a valid event type", et)
	}
	assert.False(t, IsValidEventType(""))
	assert.False(t, IsValidEventType("shopcreated"))
	assert.False(t, IsValidEventType("NoSuchEvent"))
}

func TestEventValidateOK(t *testing.T) {
	assert.NoError(t, validEvent().Validate())
}

func TestEventValidateMissingID(t *testing.T) {
	e := validEvent()
	e.ID = ""
	assert.Error(t, e.Validate())
}

func TestEventValidateMissingType(t *testing.T) {
	e := validEvent()
	e.Type = ""
	assert.Error(t, e.Validate())
}

func TestEventValidateMissingEntityID(t *testing.T) {
	e := validEvent()
	e.EntityID = ""
	assert.Error(t, e.Validate())
}

func TestEventValidateUnknownType(t *testing.T) {
	e := validEvent()
	e.Type = "NoSuchEvent"
	assert.Error(t, e.Validate())
}

func TestEventValidateNegativeLamport(t *testing.T) {
	e := validEvent()
	e.Lamport = -1
	assert.Error(t, e.Validate())
}

func TestEventValidateZeroLamportOK(t *testing.T) {
	e := validEvent()
	e.Lamport = 0
	assert.NoError(t, e.Validate())
}

func TestEventValidateInvalidPayload(t *testing.T) {
	e := validEvent()
	e.Payload = json.RawMessage(`{"name":`)
	assert.Error(t, e.Validate())
}

func TestEventValidateNilPayloadOK(t *testing.T) {
	e := validEvent()
	e.Payload = nil
	assert.NoError(t, e.Validate())
}

func TestEventValidateEmptyObjectPayloadOK(t *testing.T) {
	e := validEvent()
	e.Payload = json.RawMessage(`{}`)
	assert.NoError(t, e.Validate())
}
