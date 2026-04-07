package sync

import (
	"encoding/json"
	"time"

	"grocery/models"
)

// IsConflict returns true when the same entity was modified on both client
// and server since the last sync — meaning neither side has seen the other's
// changes.
func IsConflict(clientUpdatedAt, serverUpdatedAt, lastSyncedAt time.Time) bool {
	return clientUpdatedAt.After(lastSyncedAt) && serverUpdatedAt.After(lastSyncedAt)
}

func MakeConflict(entity, id string, client, server any) (models.Conflict, error) {
	cb, err := json.Marshal(client)
	if err != nil {
		return models.Conflict{}, err
	}
	sb, err := json.Marshal(server)
	if err != nil {
		return models.Conflict{}, err
	}
	return models.Conflict{
		Entity: entity,
		ID:     id,
		Client: cb,
		Server: sb,
	}, nil
}
