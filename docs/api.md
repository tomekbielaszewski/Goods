# API reference

| Method | Path                            | Description                                                            |
|--------|---------------------------------|------------------------------------------------------------------------|
| `GET`  | `/api/bootstrap`                | Full data dump — all tables, used on first load                        |
| `POST` | `/api/sync`                     | Bidirectional delta sync — send client changes, receive server changes |
| `POST` | `/api/report-bug`               | Submit a bug report                                                    |
| `GET`  | `/api/bug-reports`              | List all bug reports                                                   |
| `POST` | `/api/bug-reports/{id}/resolve` | Mark a bug report as resolved                                          |
| `GET`  | `/*`                            | Serves React SPA; unknown paths fall back to `index.html`              |

### GET /api/bootstrap

Returns a full snapshot of all server data. Used on first app load to populate the local IndexedDB.

```json
{
  "serverTime": "2026-04-07T10:00:00Z",
  "shops": [],
  "items": [],
  "tags": [],
  "itemShops": [],
  "itemTags": [],
  "lists": [],
  "listItems": [],
  "listItemSkippedShops": [],
  "shoppingSessions": [],
  "sessionItems": []
}
```

### POST /api/sync

Bidirectional delta sync. Send changes made on the client since `lastSyncedAt`; receive changes made on the server
since then.

**Request body:**

```json
{
  "lastSyncedAt": "2026-04-07T10:00:00Z",
  "changes": {
    "shops": [],
    "items": [],
    "tags": [],
    "itemShops": [],
    "itemTags": [],
    "lists": [],
    "listItems": [],
    "listItemSkippedShops": [],
    "shoppingSessions": [],
    "sessionItems": []
  }
}
```

**Response:**

```json
{
  "serverTime": "2026-04-07T10:05:00Z",
  "applied": [
    "id1",
    "id2"
  ],
  "conflicts": [],
  "serverChanges": {}
}
```

Conflicts occur when the same entity was modified on both client and server since `lastSyncedAt`. The app surfaces a
non-blocking notification and lets you resolve them in the Conflicts screen.

### POST /api/report-bug

Submit a bug report.

**Request body:**

```json
{
  "text": "Something went wrong when..."
}
```

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### GET /api/bug-reports

Returns all bug reports, sorted by `created_at` descending (unresolved first).

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Something went wrong when...",
    "created_at": "2026-04-07T10:00:00Z",
    "resolved_at": null
  }
]
```

### POST /api/bug-reports/{id}/resolve

Marks a bug report as resolved. Idempotent — resolving an already-resolved report returns `200`.

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Returns `404` if the report ID does not exist.
