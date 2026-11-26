"""The plugin's own route on the management listener, mounted at /api/plugins/gtmworks-people/ behind the Engine's key:
the install says, per profile (?profile=), which session belongs to an Owner, and takes the mark away again. A board
Card is marked as `card:<task id>`."""
from __future__ import annotations

import importlib.util
import pathlib

from fastapi import APIRouter
from pydantic import BaseModel

# The dashboard imports this file on its own; the marks module sits beside the plugin's __init__.py.
_spec = importlib.util.spec_from_file_location("gtmworks_people_marks", pathlib.Path(__file__).resolve().parent.parent / "marks.py")
marks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(marks)

router = APIRouter()


class Mark(BaseModel):
    session_id: str
    person: str


@router.get("/owner-sessions")
def listed():
    return {"sessions": marks.listed()}


@router.post("/owner-sessions")
def mark(body: Mark):
    marks.mark(body.session_id, body.person)
    return {"ok": True, "session_id": body.session_id}


@router.delete("/owner-sessions/{session_id}")
def unmark(session_id: str):
    return {"ok": marks.unmark(session_id), "session_id": session_id}
