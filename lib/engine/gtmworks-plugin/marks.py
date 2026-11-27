"""Which sessions are an Owner's (#884), kept in the plugin's own data of the main Agent's profile
(plugins/plugin_storage.py: <profile>/plugin-data/gtmworks/data.db), never in the plugin's folder, which a release
replaces. The plugin's route writes a mark (dashboard/plugin_api.py) and the tool reads it, both inside the Engine.
Taking a mark off before its life ends is #886's.

A mark has a short life: gtmworks marks a session again before each Run it starts, so a mark that was never taken off
(a missed removal) ends by itself."""
from __future__ import annotations

import time

NAME = "gtmworks"
# How long a mark lasts when gtmworks names no life, and the longest it may name.
DEFAULT_SECONDS = 900
LONGEST_SECONDS = 3600


def _db():
    from plugins.plugin_storage import plugin_db
    db = plugin_db(NAME)
    db.execute("CREATE TABLE IF NOT EXISTS owner_sessions (session_id TEXT PRIMARY KEY, person TEXT NOT NULL, "
               "marked REAL NOT NULL, until REAL NOT NULL)")
    return db


def life(seconds) -> float:
    """The life gtmworks asked for, within 1 second and LONGEST_SECONDS; none is DEFAULT_SECONDS."""
    if seconds is None:
        return float(DEFAULT_SECONDS)
    return float(min(max(int(seconds), 1), LONGEST_SECONDS))


def mark(session_id: str, person: str, seconds=None) -> float:
    now = time.time()
    until = now + life(seconds)
    db = _db()
    try:
        with db:
            db.execute("INSERT OR REPLACE INTO owner_sessions VALUES (?, ?, ?, ?)", (session_id, person, now, until))
    finally:
        db.close()
    return until


def read(session_id: str) -> dict | None:
    """The live mark of a session, or None: an unknown session and a mark past its life alike."""
    if not session_id:
        return None
    db = _db()
    try:
        row = db.execute("SELECT person, until FROM owner_sessions WHERE session_id = ?", (session_id,)).fetchone()
    finally:
        db.close()
    if not row or row[1] <= time.time():
        return None
    return {"person": row[0], "until": row[1]}


def listed() -> list[dict]:
    """Every live mark; one past its life is dropped here."""
    now = time.time()
    db = _db()
    try:
        with db:
            db.execute("DELETE FROM owner_sessions WHERE until <= ?", (now,))
        return [{"session_id": r[0], "person": r[1], "until": r[2]}
                for r in db.execute("SELECT session_id, person, until FROM owner_sessions ORDER BY marked")]
    finally:
        db.close()
