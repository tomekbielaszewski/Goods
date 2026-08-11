#!/usr/bin/env python3
"""Migrate a legacy (pre-events) groceries database to the event-sourced schema.

The legacy app (<= commit 1d53c73) stored state only in relational tables.
The event-sourced app treats the `events` append-only log as the source of
truth: the frontend reconstructs its whole state by replaying GET /api/events.
This script synthesizes one event per current legacy row (a create event for
every entity, plus soft-delete/archive events where applicable), appends them
to a fresh `events` table, and keeps the legacy relational projections as-is
(they are never read back except bug_reports, and the bug reports are read
straight from the table).

Run from anywhere:

    python3 scripts/migrate_legacy_to_events.py SOURCE.db TARGET.db

The target file is created as a WAL-checkpointed copy of the source, so the
copy always includes everything committed in the source's -wal file.
"""

import argparse
import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Fixed namespace so event ids are deterministic: re-running the migration on
# a partially migrated DB inserts nothing twice (event id is UNIQUE).
NAMESPACE = uuid.UUID("4df5c9b6-2c2b-4a2c-9c3a-1f7e4a2b3c4d")
CLIENT_ID = "legacy-import"

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "backend" / "db" / "schema.sql"

GO_TS = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(\.\d+)? \+0000 UTC$")


def parse_ts(value):
    """Parse a legacy Go timestamp ('2026-04-08 18:30:45.05 +0000 UTC') or an
    RFC3339 string ('2026-04-09T17:31:58Z') into a UTC datetime."""
    if value is None:
        return None
    s = str(value).strip()
    m = GO_TS.fullmatch(s)
    if m:
        base, frac = m.group(1), m.group(2) or ""
        if frac:
            parsed = datetime.strptime(base + frac, "%Y-%m-%d %H:%M:%S.%f")
        else:
            parsed = datetime.strptime(base, "%Y-%m-%d %H:%M:%S")
        return parsed.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"unparseable timestamp: {value!r}")


def iso(ts):
    """Format a datetime as '2026-04-08T18:30:45.050Z' — the exact shape the
    frontend generates (new Date().toISOString())."""
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="legacy SQLite database file")
    parser.add_argument("target", help="migrated SQLite database file to write")
    parser.add_argument("--force", action="store_true", help="overwrite an existing target file")
    args = parser.parse_args()

    src = Path(args.source)
    tgt = Path(args.target)
    if not src.is_file():
        sys.exit(f"source database not found: {src}")
    if tgt.exists() and not args.force:
        sys.exit(f"target already exists (use --force to overwrite): {tgt}")
    if tgt.exists():
        tgt.unlink()
    tgt.parent.mkdir(parents=True, exist_ok=True)

    # 1. Checkpointed copy — VACUUM INTO reads the committed state including
    #    the source's -wal file and writes a standalone, WAL-free file.
    src_conn = sqlite3.connect(str(src))
    try:
        src_conn.execute(f"VACUUM INTO '{tgt.as_posix().replace(chr(39), chr(39) * 2)}'")
    finally:
        src_conn.close()

    conn = sqlite3.connect(str(tgt))
    try:
        migrate(conn)
    finally:
        conn.close()


def migrate(conn):
    cur = conn.cursor()
    has_events = cur.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='events'"
    ).fetchone()[0]
    if has_events:
        existing = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if existing > 0:
            sys.exit("source already contains an event log — nothing to migrate")

    # 2. Apply the current schema (idempotent CREATE TABLE IF NOT EXISTS; the
    #    missing events table is created, everything else is left untouched).
    schema = SCHEMA_PATH.read_text()
    conn.executescript(schema)

    events = build_events(cur)
    if not events:
        print("no data to migrate")
        return

    received_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    total = 0
    for e in events:
        cur.execute(
            """INSERT OR IGNORE INTO events(id, client_id, type, entity_id, payload, timestamp, lamport, received_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (e["id"], CLIENT_ID, e["type"], e["entity_id"], e["payload"], e["timestamp"], e["lamport"], received_at),
        )
        total += cur.rowcount
    conn.commit()

    by_type = {}
    for e in events:
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    last_seq = cur.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    print(f"migrated {total} events (seq 1..{last_seq}):")
    for t, n in sorted(by_type.items()):
        print(f"  {t:32s} {n}")


def build_events(cur):
    """Synthesize the event log that reconstructs the current legacy state."""
    events = []

    def emit(type_, entity_id, payload, ts, key):
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        event_id = str(uuid.uuid5(NAMESPACE, f"{type_}:{entity_id}:{key}"))
        events.append(
            {
                "id": event_id,
                "type": type_,
                "entity_id": entity_id,
                "payload": canonical,
                "timestamp": iso(ts),
                "lamport": len(events) + 1,
            }
        )

    def emit_with_delete(type_prefix, rows, create_payload, delete_payload, key_col):
        for row in rows:
            emit(f"{type_prefix}Created", row[0], create_payload(row), parse_ts(row[1]), key_col(row))
            deleted_at = parse_ts(row[2])
            if deleted_at is not None:
                emit(f"{type_prefix}SoftDeleted", row[0], delete_payload(row), deleted_at, key_col(row))

    # Latest timestamp across the whole DB — deterministic stand-in for the
    # timestamps the legacy schema did not track (tags have none).
    backstop = datetime.fromtimestamp(0, tz=timezone.utc)
    for tbl, col in [
        ("shops", "updated_at"),
        ("items", "updated_at"),
        ("lists", "updated_at"),
        ("list_items", "updated_at"),
        ("shopping_sessions", "started_at"),
        ("session_items", "at"),
        ("list_item_skipped_shops", "skipped_at"),
        ("bug_reports", "created_at"),
    ]:
        (mx,) = cur.execute(f"SELECT COALESCE(MAX({col}), '') FROM {tbl}").fetchone()
        if mx:
            backstop = max(backstop, parse_ts(mx))

    # shops
    rows = cur.execute(
        "SELECT id, name, color, updated_at, deleted_at FROM shops ORDER BY updated_at"
    ).fetchall()
    for r in rows:
        emit("ShopCreated", r[0], {"name": r[1], "color": r[2]}, parse_ts(r[3]), r[0])
        if parse_ts(r[4]) is not None:
            emit("ShopSoftDeleted", r[0], {"deletedAt": iso(parse_ts(r[4]))}, parse_ts(r[4]), r[0])

    # tags (no timestamps in the legacy schema)
    rows = cur.execute("SELECT id, name FROM tags ORDER BY rowid").fetchall()
    for r in rows:
        emit("TagCreated", r[0], {"name": r[1]}, backstop, r[0])

    # items
    rows = cur.execute(
        """SELECT id, name, unit, default_quantity, description, notes, created_at, deleted_at
           FROM items ORDER BY created_at"""
    ).fetchall()
    for r in rows:
        payload = {"name": r[1]}
        if r[2] is not None:
            payload["unit"] = r[2]
        if r[3] is not None:
            payload["defaultQuantity"] = r[3]
        if r[4] is not None:
            payload["description"] = r[4]
        if r[5] is not None:
            payload["notes"] = r[5]
        created = parse_ts(r[6])
        emit("ItemCreated", r[0], payload, created, r[0])
        if parse_ts(r[7]) is not None:
            emit("ItemSoftDeleted", r[0], {"deletedAt": iso(parse_ts(r[7]))}, parse_ts(r[7]), r[0])

    # item_shops
    rows = cur.execute(
        "SELECT item_id, shop_id FROM item_shops ORDER BY item_id, shop_id"
    ).fetchall()
    for item_id, shop_id in rows:
        emit("ShopAssignedToItem", item_id, {"shopId": shop_id}, backstop, shop_id)

    # item_tags
    rows = cur.execute(
        "SELECT item_id, tag_id FROM item_tags ORDER BY item_id, tag_id"
    ).fetchall()
    for item_id, tag_id in rows:
        emit("TagAssignedToItem", item_id, {"tagId": tag_id}, backstop, tag_id)

    # lists
    rows = cur.execute(
        "SELECT id, name, created_at, archived_at, deleted_at FROM lists ORDER BY created_at"
    ).fetchall()
    for r in rows:
        created = parse_ts(r[2])
        emit("ListCreated", r[0], {"name": r[1]}, created, r[0])
        archived_at = parse_ts(r[3])
        deleted_at = parse_ts(r[4])
        for ts, type_, payload_key in sorted(
            [
                (archived_at, "ListArchived", "archivedAt"),
                (deleted_at, "ListDeleted", "deletedAt"),
            ],
            key=lambda x: (x[0] is None, x[0]),
        ):
            if ts is not None:
                emit(type_, r[0], {payload_key: iso(ts)}, ts, r[0])

    # list_items
    rows = cur.execute(
        """SELECT id, list_id, item_id, state, quantity, unit, notes, added_at
           FROM list_items ORDER BY list_id, added_at"""
    ).fetchall()
    for r in rows:
        payload = {"listId": r[1], "itemId": r[2], "state": r[3]}
        if r[4] is not None:
            payload["quantity"] = r[4]
        if r[5] is not None:
            payload["unit"] = r[5]
        if r[6] is not None:
            payload["notes"] = r[6]
        emit("ListItemAdded", r[0], payload, parse_ts(r[7]), r[0])

    # list_item_skipped_shops
    rows = cur.execute(
        "SELECT list_item_id, shop_id, skipped_at FROM list_item_skipped_shops ORDER BY list_item_id"
    ).fetchall()
    for list_item_id, shop_id, skipped_at in rows:
        emit("ShopSkippedForListItem", list_item_id, {"shopId": shop_id}, parse_ts(skipped_at), shop_id)

    # shopping_sessions
    rows = cur.execute(
        "SELECT id, list_id, shop_id, started_at FROM shopping_sessions ORDER BY started_at"
    ).fetchall()
    for r in rows:
        emit(
            "ShoppingSessionStarted",
            r[0],
            {"listId": r[1], "shopId": r[2]},
            parse_ts(r[3]),
            r[0],
        )

    # session_items
    rows = cur.execute(
        """SELECT id, session_id, item_id, action, quantity, unit, at
           FROM session_items ORDER BY session_id, at"""
    ).fetchall()
    for r in rows:
        payload = {"itemId": r[2]}
        if r[4] is not None:
            payload["quantity"] = r[4]
        if r[5] is not None:
            payload["unit"] = r[5]
        emit("SessionItemBought" if r[3] == "bought" else "SessionItemSkipped", r[1], payload, parse_ts(r[6]), r[0])

    # bug_reports
    rows = cur.execute(
        "SELECT id, text, created_at FROM bug_reports ORDER BY created_at"
    ).fetchall()
    for r in rows:
        emit("BugReported", r[0], {"text": r[1]}, parse_ts(r[2]), r[0])

    return events


if __name__ == "__main__":
    main()
