package sync_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"grocery/models"
	gsync "grocery/sync"
)

// ---------------------------------------------------------------------------
// IsConflict
// ---------------------------------------------------------------------------

func TestIsConflict_BothChangedAfterSync(t *testing.T) {
	syncTime := time.Now().UTC().Add(-10 * time.Minute)
	clientUpdated := syncTime.Add(5 * time.Minute)
	serverUpdated := syncTime.Add(3 * time.Minute)

	assert.True(t, gsync.IsConflict(clientUpdated, serverUpdated, syncTime),
		"both sides changed after last sync — should be a conflict")
}

func TestIsConflict_OnlyClientChanged(t *testing.T) {
	syncTime := time.Now().UTC().Add(-10 * time.Minute)
	clientUpdated := syncTime.Add(5 * time.Minute)
	serverUpdated := syncTime.Add(-1 * time.Minute) // before sync

	assert.False(t, gsync.IsConflict(clientUpdated, serverUpdated, syncTime),
		"only client changed — not a conflict, client wins")
}

func TestIsConflict_OnlyServerChanged(t *testing.T) {
	syncTime := time.Now().UTC().Add(-10 * time.Minute)
	clientUpdated := syncTime.Add(-2 * time.Minute) // before sync
	serverUpdated := syncTime.Add(4 * time.Minute)

	assert.False(t, gsync.IsConflict(clientUpdated, serverUpdated, syncTime),
		"only server changed — not a conflict, server wins")
}

func TestIsConflict_NeitherChanged(t *testing.T) {
	syncTime := time.Now().UTC().Add(-10 * time.Minute)
	clientUpdated := syncTime.Add(-5 * time.Minute) // before sync
	serverUpdated := syncTime.Add(-3 * time.Minute) // before sync

	assert.False(t, gsync.IsConflict(clientUpdated, serverUpdated, syncTime),
		"neither side changed after last sync — no conflict")
}

func TestIsConflict_ExactlyAtSyncTime(t *testing.T) {
	syncTime := time.Now().UTC().Add(-10 * time.Minute)

	// Exactly equal to syncTime is NOT strictly after, so no conflict.
	assert.False(t, gsync.IsConflict(syncTime, syncTime, syncTime),
		"timestamps equal to syncTime are not strictly after — no conflict")
}

// ---------------------------------------------------------------------------
// MakeConflict
// ---------------------------------------------------------------------------

func TestMakeConflict_SerializesCorrectly(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)

	client := models.Shop{
		ID:        "shop-1",
		Name:      "Client Shop",
		Color:     "#ff0000",
		Version:   2,
		UpdatedAt: now,
	}
	server := models.Shop{
		ID:        "shop-1",
		Name:      "Server Shop",
		Color:     "#00ff00",
		Version:   3,
		UpdatedAt: now.Add(time.Minute),
	}

	conflict, err := gsync.MakeConflict("shop", "shop-1", client, server)
	require.NoError(t, err)

	assert.Equal(t, "shop", conflict.Entity)
	assert.Equal(t, "shop-1", conflict.ID)

	// Client payload must be valid JSON containing the client name.
	var clientDecoded map[string]any
	require.NoError(t, json.Unmarshal(conflict.Client, &clientDecoded),
		"Client field must be valid JSON")
	assert.Equal(t, "Client Shop", clientDecoded["name"])
	assert.Equal(t, "shop-1", clientDecoded["id"])

	// Server payload must be valid JSON containing the server name.
	var serverDecoded map[string]any
	require.NoError(t, json.Unmarshal(conflict.Server, &serverDecoded),
		"Server field must be valid JSON")
	assert.Equal(t, "Server Shop", serverDecoded["name"])
	assert.Equal(t, "shop-1", serverDecoded["id"])
}
