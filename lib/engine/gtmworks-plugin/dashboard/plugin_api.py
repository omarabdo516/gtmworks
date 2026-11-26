"""The plugin's own route on the Engine's management listener (#884), mounted at /api/plugins/gtmworks/ behind the
Engine's key: gtmworks says, for the main Agent's profile (?profile=), which session is an Owner's, and takes the mark
off again. Nothing here opens a connection out of the Engine."""
from __future__ import annotations

import importlib.util
import pathlib
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

# The dashboard imports this file on its own; the marks module sits beside the plugin's __init__.py.
_spec = importlib.util.spec_from_file_location("gtmworks_plugin_marks", pathlib.Path(__file__).resolve().parent.parent / "marks.py")
marks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(marks)

router = APIRouter()


class Mark(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    person: str = Field(min_length=1, max_length=200)
    seconds: Optional[int] = None


@router.get("/owner-sessions")
def listed():
    return {"sessions": marks.listed()}


@router.post("/owner-sessions")
def mark(body: Mark):
    until = marks.mark(body.session_id, body.person, body.seconds)
    return {"ok": True, "session_id": body.session_id, "until": until}


@router.delete("/owner-sessions/{session_id}")
def unmark(session_id: str):
    return {"ok": True, "removed": marks.unmark(session_id), "session_id": session_id}


@router.delete("/people/{person}")
def unmark_person(person: str):
    return {"ok": True, "removed": marks.unmark_person(person), "person": person}
