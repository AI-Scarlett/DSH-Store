#!/usr/bin/env python3
"""Private SQLite FTS5 worker for the DSH Store model service."""

import json
import os
import re
import sqlite3
import sys
from pathlib import Path


os.umask(0o077)
database_path = Path(sys.argv[1]).expanduser().resolve()
database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)


def emit(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def connect():
    connection = sqlite3.connect(str(database_path), timeout=30)
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS plugin_catalog (
               id TEXT PRIMARY KEY,
               package_name TEXT NOT NULL,
               display_name TEXT NOT NULL,
               aliases TEXT NOT NULL,
               purpose TEXT NOT NULL,
               search_terms TEXT NOT NULL,
               categories TEXT NOT NULL,
               status TEXT NOT NULL,
               commit_hash TEXT NOT NULL
           )"""
    )
    connection.execute(
        """CREATE VIRTUAL TABLE IF NOT EXISTS plugin_catalog_fts USING fts5(
               plugin_id UNINDEXED,
               package_name,
               display_name,
               aliases,
               purpose,
               search_terms,
               categories,
               tokenize='unicode61 remove_diacritics 2'
           )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS catalog_state (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               source_commit TEXT,
               catalog_sha256 TEXT NOT NULL,
               entry_count INTEGER NOT NULL,
               synced_at TEXT NOT NULL
           )"""
    )
    connection.commit()
    try:
        os.chmod(database_path, 0o600)
    except OSError:
        if os.name != "nt":
            raise
    return connection


connection = connect()


def clean_text(value, maximum=4096):
    if isinstance(value, list):
        value = " ".join(str(item) for item in value if item is not None)
    if not isinstance(value, str):
        return ""
    return value[:maximum]


def replace_catalog(command):
    records = command.get("records")
    state = command.get("state")
    if not isinstance(records, list) or not isinstance(state, dict):
        raise ValueError("invalid-replacement")
    if not re.fullmatch(r"[0-9a-f]{64}", str(state.get("catalogSha256", ""))):
        raise ValueError("invalid-catalog-hash")

    base_rows = []
    fts_rows = []
    seen = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("invalid-record")
        plugin_id = clean_text(record.get("id"), 256).strip()
        package_name = clean_text(record.get("packageName"), 512).strip()
        if not plugin_id or not package_name or plugin_id in seen:
            raise ValueError("invalid-record-identity")
        seen.add(plugin_id)
        display_name = clean_text(record.get("displayName"), 512).strip()
        aliases = clean_text(record.get("aliases"), 2048)
        purpose = clean_text(record.get("purpose"), 4096)
        search_terms = clean_text(record.get("searchTerms"), 4096)
        categories = clean_text(record.get("categories"), 1024)
        status = clean_text(record.get("status"), 64)
        commit_hash = clean_text(record.get("commit"), 128)
        base_rows.append((plugin_id, package_name, display_name, aliases, purpose,
                          search_terms, categories, status, commit_hash))
        fts_rows.append((plugin_id, package_name, display_name, aliases, purpose,
                         search_terms, categories))

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("DELETE FROM plugin_catalog_fts")
        connection.execute("DELETE FROM plugin_catalog")
        connection.executemany(
            """INSERT INTO plugin_catalog
               (id, package_name, display_name, aliases, purpose, search_terms,
                categories, status, commit_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            base_rows,
        )
        connection.executemany(
            """INSERT INTO plugin_catalog_fts
               (plugin_id, package_name, display_name, aliases, purpose,
                search_terms, categories)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            fts_rows,
        )
        connection.execute(
            """INSERT INTO catalog_state
               (singleton, source_commit, catalog_sha256, entry_count, synced_at)
               VALUES (1, ?, ?, ?, ?)
               ON CONFLICT(singleton) DO UPDATE SET
                 source_commit=excluded.source_commit,
                 catalog_sha256=excluded.catalog_sha256,
                 entry_count=excluded.entry_count,
                 synced_at=excluded.synced_at""",
            (clean_text(state.get("sourceCommit"), 40) or None,
             state["catalogSha256"], len(records), clean_text(state.get("syncedAt"), 64)),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    os.chmod(database_path, 0o600)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(database_path) + suffix)
        if sidecar.exists():
            os.chmod(sidecar, 0o600)
    return {"entryCount": len(records), "catalogSha256": state["catalogSha256"]}


def search(command):
    tokens = command.get("tokens")
    limit = command.get("limit", 256)
    if not isinstance(tokens, list) or not isinstance(limit, int) or not 1 <= limit <= 512:
        raise ValueError("invalid-search")
    safe_tokens = []
    for token in tokens:
        if not isinstance(token, str):
            continue
        token = token.strip()
        if token and len(token) <= 80 and re.fullmatch(r"[\w\u3400-\u9fff.-]+", token, re.UNICODE):
            safe_tokens.append(token)
    safe_tokens = list(dict.fromkeys(safe_tokens))
    if not safe_tokens:
        return {"ids": []}
    match = " OR ".join('"' + token.replace('"', '""') + '"' for token in safe_tokens)
    rows = connection.execute(
        """SELECT DISTINCT f.plugin_id
           FROM plugin_catalog_fts AS f
           JOIN plugin_catalog AS p ON p.id = f.plugin_id
           WHERE plugin_catalog_fts MATCH ?
             AND p.status = 'approved'
             AND length(p.commit_hash) = 40
             AND lower(p.commit_hash) NOT GLOB '*[^0-9a-f]*'
           ORDER BY bm25(plugin_catalog_fts)
           LIMIT ?""",
        (match, limit),
    ).fetchall()
    return {"ids": [row[0] for row in rows]}


def read_state():
    row = connection.execute(
        "SELECT source_commit, catalog_sha256, entry_count, synced_at FROM catalog_state WHERE singleton=1"
    ).fetchone()
    if not row:
        return {"state": None}
    return {"state": {
        "sourceCommit": row[0],
        "catalogSha256": row[1],
        "entryCount": row[2],
        "syncedAt": row[3],
    }}


for line in sys.stdin:
    request_id = None
    try:
        command = json.loads(line)
        request_id = command.get("id")
        action = command.get("action")
        if action == "init":
            result = {"ready": True}
        elif action == "replace":
            result = replace_catalog(command)
        elif action == "search":
            result = search(command)
        elif action == "status":
            result = read_state()
        elif action == "close":
            emit({"id": request_id, "ok": True, "result": {"closed": True}})
            break
        else:
            raise ValueError("unknown-action")
        emit({"id": request_id, "ok": True, "result": result})
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).startswith("invalid-") else "database-operation-failed"
        emit({"id": request_id, "ok": False, "error": code})

connection.close()
