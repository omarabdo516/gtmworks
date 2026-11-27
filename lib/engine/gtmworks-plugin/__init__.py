"""gtmworks's plugin of the main Agent's profile (#884, spec #865): one tool, ``gtmworks_make_agent``, that makes an
Agent when an Owner of the Company asks the main Agent for one in a Conversation.

The worker places these files in the main Agent's profile through the Engine's own management listener and restarts the
Engine once when they first appear or change (lib/main-agent-plugin.mjs). gtmworks tells the plugin, through its route
(dashboard/plugin_api.py), that a session is an Owner's; the tool reads that mark from the plugin's data in the Engine's
own volume (marks.py), so it decides with no call out of the Engine. In a marked session it makes the new Agent's profile
from inside the Engine and answers with the profile's name; in any other it refuses with a reason the Agent can say.

What it leans on: the session comes from the documented ``session_id`` the dispatcher passes a handler; making a profile
comes from Engine internals (``hermes_cli.profiles``), listed in docs/engine-probes/plugin-tool.md, whose probe is the
check at each Engine pin bump.
"""
from __future__ import annotations

import json
import os
import uuid

from . import marks

TOOL = "gtmworks_make_agent"
# The Engine keeps a display name of 64 characters at most (hermes_cli.profiles.set_profile_display_name).
NAME_LIMIT = 64
SPECIALITY_LIMIT = 300
INSTRUCTIONS_LIMIT = 20000

SCHEMA = {
    "name": TOOL,
    "description": ("Make a new Agent on the Company's team, for recurring or specialist work no Agent does. Only an Administrator "
                    "of the Company may ask for one; for anyone else the tool refuses and says why."),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "The new Agent's name, as people will call it."},
            "speciality": {"type": "string", "description": "What the new Agent does, in one sentence."},
            "instructions": {"type": "string", "description": "The new Agent's first instructions: how it works and what it must know."},
        },
        "required": ["name", "speciality", "instructions"],
    },
}

NOT_OWNER = "Only an Administrator of this Company can make an Agent. Ask an Administrator to make it."


def _answer(success: bool, **fields) -> str:
    return json.dumps({"success": success, **fields}, ensure_ascii=False)


def _refused(error: str) -> str:
    return _answer(False, error=error)


def _taken(profiles, name: str) -> bool:
    wanted = name.casefold()
    for profile in profiles.list_profiles():
        shown = (getattr(profile, "display_name", "") or "").strip()
        if shown.casefold() == wanted or str(getattr(profile, "name", "")).casefold() == wanted:
            return True
    return False


def _same_tools(path) -> None:
    """The new profile starts with the main Agent's own tools, which gtmworks keeps to the fixed set every Agent gets
    (lib/agent-toolsets.mjs toolConfig), never with the Engine's defaults: the main Agent's plugin toolset left out, and
    its commands starting in its own folder of the Company's work folder."""
    from pathlib import Path
    from hermes_cli.config import read_user_config_raw
    from hermes_constants import get_hermes_home
    from utils import atomic_yaml_write
    main = read_user_config_raw(Path(get_hermes_home()) / "config.yaml")
    target = Path(str(path)) / "config.yaml"
    config = read_user_config_raw(target)
    listed = (main.get("platform_toolsets") or {}).get("api_server")
    if isinstance(listed, list):
        config["platform_toolsets"] = {**(config.get("platform_toolsets") or {}),
                                       "api_server": [name for name in listed if name != "gtmworks"]}
    for key in ("approvals", "bot_desktop"):
        if isinstance(main.get(key), dict):
            config[key] = dict(main[key])
    disabled = (main.get("agent") or {}).get("disabled_toolsets")
    if isinstance(disabled, list):
        config["agent"] = {**(config.get("agent") or {}), "disabled_toolsets": list(disabled)}
    config["terminal"] = {**(config.get("terminal") or {}), "cwd": f"/work/{Path(str(path)).name}"}
    atomic_yaml_write(target, config, sort_keys=False)


def make_agent(args: dict, **kwargs) -> str:
    if not marks.read(str(kwargs.get("session_id") or "")):
        return _refused(NOT_OWNER)
    name = str(args.get("name") or "").strip()
    speciality = " ".join(str(args.get("speciality") or "").split())
    instructions = str(args.get("instructions") or "").strip()
    if not name:
        return _refused("Give the new Agent a name.")
    if len(name) > NAME_LIMIT:
        return _refused(f"The new Agent's name is longer than {NAME_LIMIT} characters. Choose a shorter one.")
    if not speciality:
        return _refused("Say in one sentence what the new Agent does.")
    if len(speciality) > SPECIALITY_LIMIT:
        return _refused(f"The new Agent's speciality is longer than {SPECIALITY_LIMIT} characters. Say it in one sentence.")
    if len(instructions) > INSTRUCTIONS_LIMIT:
        return _refused(f"The new Agent's instructions are longer than {INSTRUCTIONS_LIMIT} characters. Make them shorter.")
    made = None
    try:
        from hermes_cli import profiles
        if _taken(profiles, name):
            return _refused(f"An Agent named {name} already exists. Choose another name.")
        # An Agent's own profile is ag-<agent id> (lib/agent-toolsets.mjs isAgentProfile), so gtmworks reads the new Agent's
        # id from the profile's name.
        profile = f"ag-{uuid.uuid4().hex}"
        path = profiles.create_profile(name=profile, soul=instructions or None, description=speciality)
        made = profile
        profiles.seed_profile_skills(path, quiet=True)
        _same_tools(path)
        profiles.set_profile_display_name(profile, name)
        # The new profile takes Runs on the Engine's own key, as gtmworks gives every profile (lib/engine/agents.mjs).
        key = os.environ.get("API_SERVER_KEY", "")
        if key:
            with open(os.path.join(str(path), ".env"), "a", encoding="utf-8") as env:
                env.write(f"API_SERVER_KEY={key}\n")
    except Exception as exc:  # noqa: BLE001 - the Agent says what the Engine answered
        # A profile this call made and could not finish goes again, so a half-made Agent never holds the name; nothing
        # else is removed.
        left = ""
        if made:
            try:
                profiles.delete_profile(made, yes=True)
            except Exception:  # noqa: BLE001 - a profile that cannot go gives up its name and is named below
                # It no longer holds the Agent's name, so asking again is not refused as taken; the reply names it for
                # an Owner to remove on the Engine's dashboard.
                try:
                    profiles.set_profile_display_name(made, "")
                except Exception:  # noqa: BLE001
                    pass
                left = f" A part-made profile {made} is left on the Engine; an Administrator can remove it on the Engine's dashboard."
        # The Engine's own words, kept short: they reach the Agent's reply, so never a path or a value beyond them.
        return _refused(f"The Engine could not make the Agent: {type(exc).__name__}: {str(exc)[:200]}.{left}")
    return _answer(True, profile=profile, name=name, speciality=speciality)


def register(ctx) -> None:
    ctx.register_tool(name=TOOL, toolset="gtmworks", schema=SCHEMA, handler=make_agent, description=SCHEMA["description"])
