"""Which sessions are an Owner's, kept in the plugin's own data folder of the profile (plugins/plugin_storage.py):
the management route writes it, the tool reads it, both inside the Engine."""
from __future__ import annotations

import time

NAME = "gtmworks-people"


def _db():
    from plugins.plugin_storage import plugin_db
    db = plugin_db(NAME)
    db.execute("CREATE TABLE IF NOT EXISTS owner_sessions (session_id TEXT PRIMARY KEY, person TEXT NOT NULL, at REAL NOT NULL)")
    return db


def mark(session_id: str, person: str) -> None:
    db = _db()
    try:
        with db:
            db.execute("INSERT OR REPLACE INTO owner_sessions VALUES (?, ?, ?)", (session_id, person, time.time()))
    finally:
        db.close()


def unmark(session_id: str) -> bool:
    db = _db()
    try:
        with db:
            return db.execute("DELETE FROM owner_sessions WHERE session_id = ?", (session_id,)).rowcount > 0
    finally:
        db.close()


def read(session_id: str) -> dict | None:
    if not session_id:
        return None
    db = _db()
    try:
        row = db.execute("SELECT person, at FROM owner_sessions WHERE session_id = ?", (session_id,)).fetchone()
    finally:
        db.close()
    return {"person": row[0], "at": row[1]} if row else None


def listed() -> list[dict]:
    db = _db()
    try:
        return [{"session_id": r[0], "person": r[1], "at": r[2]}
                for r in db.execute("SELECT session_id, person, at FROM owner_sessions ORDER BY at")]
    finally:
        db.close()
