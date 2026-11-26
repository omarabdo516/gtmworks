"""Probe C of gtmworks spec #822 (#828, #829). Not part of the product.

One tool, ``gtmworks_make_agent``. The install tells the plugin which sessions are an Owner's through the plugin's own
route on the management listener (dashboard/plugin_api.py); the tool reads that mark from the plugin's data in the
Engine's own volume, so it decides with no call out of the Engine. In an Owner's session it makes a profile from inside
the Engine; in any other session it refuses with a reason the Agent can say.
"""
from __future__ import annotations

import json
import os
import time

from . import marks

SCHEMA = {
    "name": "gtmworks_make_agent",
    "description": "Make a new Agent for the Company. Only an Owner may ask for one.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "The new Agent's profile name (lowercase letters, digits, dashes)."},
            "job": {"type": "string", "description": "What the new Agent does, in a sentence."},
        },
        "required": ["name", "job"],
    },
}


def _told(kwargs: dict) -> dict:
    """Everything the handler can know about its Run: what the dispatcher passes, and what the Engine's own scope says."""
    told = {key: (value if isinstance(value, (str, int, float, bool, type(None))) else type(value).__name__)
            for key, value in kwargs.items()}
    try:
        from hermes_constants import get_hermes_home
        told["hermes_home"] = str(get_hermes_home())
    except Exception as exc:  # noqa: BLE001 - the probe reports what it could not read
        told["hermes_home"] = f"unreadable: {exc}"
    try:
        from gateway.session_context import get_session_env
        for name in ("HERMES_SESSION_PLATFORM", "HERMES_SESSION_SOURCE", "HERMES_SESSION_CHAT_ID",
                     "HERMES_SESSION_USER_ID", "HERMES_SESSION_KEY", "HERMES_SESSION_ID"):
            value = get_session_env(name, "")
            if value:
                told[name] = value
    except Exception as exc:  # noqa: BLE001
        told["session_env"] = f"unreadable: {exc}"
    for name in ("HERMES_KANBAN_TASK", "HERMES_KANBAN_BOARD", "HERMES_PLATFORM"):
        if os.environ.get(name):
            told[name] = os.environ[name]
    return told


def make_agent(args: dict, **kwargs) -> str:
    session = kwargs.get("session_id") or ""
    told = _told(kwargs)
    # A Conversation's Run is marked by its session; a board worker's Run, whose session the install never sees before it
    # starts, by its Card (the dispatcher names it in HERMES_KANBAN_TASK).
    card = os.environ.get("HERMES_KANBAN_TASK", "")
    mark = marks.read(session) or (marks.read(f"card:{card}") if card else None)
    if not mark:
        return json.dumps({"success": False, "told": told,
                           "error": "Only an Owner of this Company can make an Agent. Ask an Owner to make it."})
    name = str(args.get("name") or "").strip()
    job = str(args.get("job") or "").strip()
    try:
        from hermes_cli import profiles
        path = profiles.create_profile(name=name, soul=job)
        profiles.seed_profile_skills(path, quiet=True)
        # The new profile takes Runs on the Engine's own key, as the install gives every profile (lib/hermes.mjs).
        key = os.environ.get("API_SERVER_KEY", "")
        if key:
            with open(os.path.join(str(path), ".env"), "a", encoding="utf-8") as env:
                env.write(f"API_SERVER_KEY={key}\n")
    except Exception as exc:  # noqa: BLE001 - the Agent says what the Engine answered
        return json.dumps({"success": False, "told": told, "error": f"The Engine did not make the Agent: {exc}"})
    return json.dumps({"success": True, "told": told, "made": name, "path": str(path),
                       "owner": mark.get("person"), "at": time.time()})


def register(ctx) -> None:
    ctx.register_tool(name="gtmworks_make_agent", toolset="gtmworks", schema=SCHEMA, handler=make_agent,
                      description=SCHEMA["description"])
