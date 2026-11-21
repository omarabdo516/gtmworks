"""The file-sync probes (#393), run inside the pinned Engine. One phase per call: file-sync.sh runs
them in order, with the idle reaper's teardown between them.

Does the ssh backend copy the Engine's own files (a profile's cache, its skills, the Company's shared
Skills folder) into the work sandbox, and copy the sandbox's changes back onto the Engine's disk?
It reuses probe.py's Run driver and provider.py's scripted model; nothing here is gtmworks code.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "/opt/probe")
import probe  # noqa: E402
import provider  # noqa: E402

A, B = "probe-a", "probe-b"
SHARED = "/opt/data/profiles/probe-space/skills"   # the Company's shared Skills folder (lib: profiles/<space>/skills)
HOME = Path("/opt/data/profiles")
REMOTE = "/home/pn/.hermes"
for name in (A, B):
    probe.KEYS[name] = (name.replace("-", "0") + "k")[:40].ljust(40, "k")


def terminal(profile: str, plan: str, command: str) -> str:
    answer = probe.run(profile, plan, [{"name": "terminal", "arguments": {"command": command}}])
    if not answer.get("results"):
        return f"no tool result (run {answer.get('state') or answer['started']}: {answer.get('detail', '')})"
    try:
        result = json.loads(answer["results"][0])
        return f"exit={result.get('exit_code')} error={result.get('error')}\n{result.get('output')}"
    except Exception:  # noqa: BLE001
        return answer["results"][0][:1500]


def show(label: str, text: str) -> None:
    print(f"--- {label}")
    print(text.rstrip())


def engine_file(path: str) -> str:
    try:
        return Path(path).read_text().strip().replace("\n", " | ")
    except Exception as error:  # noqa: BLE001
        return type(error).__name__


def setup() -> None:
    """Two Agents of one Company: each reads the shared folder, as lib/ sets skills.external_dirs."""
    probe.until("the management listener", lambda: probe.call("GET", probe.MANAGE + "/api/profiles")[0] == 200)
    for name in (A, B):
        probe.make_profile(name, probe.AGENT_TOOLSETS, probe.ALWAYS_OFF)
        status, body = probe.call("PUT", probe.MANAGE + f"/api/config?profile={name}",
                                  {"config": {"skills": {"external_dirs": [SHARED]}}})
        print(f"setup {name}: skills.external_dirs={SHARED} -> {status} {body[:60]}")
    # What sits on the Engine before any command: A's cache and attachments, A's own Skill, the
    # shared Skill. All written by the Engine's own uid, as the Engine writes them.
    for rel, text in (("cache/documents/gw393-a-doc.txt", "GW393 A's document (uploaded by a person)"),
                      ("attachments/gw393-a-attachment.txt", "GW393 A's attachment"),
                      ("cache/delegation/gw393-a-delegation.txt", "GW393 A's delegation cache"),
                      ("skills/a-own/SKILL.md", "---\nname: a-own\ndescription: A's own\n---\nGW393 A-OWN original\n")):
        path = HOME / A / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    Path(SHARED, "shared-one").mkdir(parents=True, exist_ok=True)
    Path(SHARED, "shared-one", "SKILL.md").write_text(
        "---\nname: shared-one\ndescription: the Company's\n---\nGW393 SHARED original\n")
    print("setup: engine files written")


LIST = f"find {REMOTE} -type f | sort; echo; id -un; hostname"


def upload() -> None:
    show("1 A's first command: every file under the sandbox's ~/.hermes", terminal(A, "a-list", LIST))
    show("1 A reads its own document in the sandbox",
         terminal(A, "a-cat", f"cat {REMOTE}/cache/documents/gw393-a-doc.txt {REMOTE}/attachments/gw393-a-attachment.txt"))
    show("1 B's command reads A's document and attachment",
         terminal(B, "b-cat", f"cat {REMOTE}/cache/documents/gw393-a-doc.txt; echo; "
                              f"cat {REMOTE}/attachments/gw393-a-attachment.txt; echo; "
                              f"cat {REMOTE}/cache/delegation/gw393-a-delegation.txt"))
    show("2 the shared Skill in the sandbox (A's command)",
         terminal(A, "a-shared", f"cat {REMOTE}/external_skills/0/shared-one/SKILL.md"))
    show("2/3 A edits the shared Skill, its own Skill, and adds files the Engine never had",
         terminal(A, "a-edit", "set -e; "
                  f"echo 'GW393 SHARED EDITED IN SANDBOX' >> {REMOTE}/external_skills/0/shared-one/SKILL.md; "
                  f"mkdir -p {REMOTE}/external_skills/0/planted; "
                  f"printf -- '---\\nname: planted\\ndescription: planted from the sandbox\\n---\\nGW393 PLANTED\\n' > {REMOTE}/external_skills/0/planted/SKILL.md; "
                  f"echo 'GW393 A-OWN EDITED IN SANDBOX' >> {REMOTE}/skills/a-own/SKILL.md; "
                  f"echo 'GW393 new file next to A-OWN' > {REMOTE}/skills/a-own/new.md; "
                  f"echo 'GW393 sandbox-made document' > {REMOTE}/cache/documents/gw393-sandbox-made.txt; "
                  f"echo 'GW393 A doc rewritten in sandbox' > {REMOTE}/cache/documents/gw393-a-doc.txt; "
                  "echo edited"))
    show("2/3 the Engine's copies right after the edit (before any teardown)", check_lines())


def check_lines() -> str:
    lines = []
    for path in (f"{SHARED}/shared-one/SKILL.md", f"{SHARED}/planted/SKILL.md",
                 f"{HOME}/{A}/skills/a-own/SKILL.md", f"{HOME}/{A}/skills/a-own/new.md",
                 f"{HOME}/{A}/cache/documents/gw393-a-doc.txt", f"{HOME}/{A}/cache/documents/gw393-sandbox-made.txt",
                 f"{HOME}/{B}/cache/documents/gw393-a-doc.txt", f"{HOME}/{B}/cache/documents/gw393-sandbox-made.txt",
                 f"{HOME}/{B}/skills/a-own/SKILL.md",
                 "/opt/data/skills/a-own/SKILL.md", "/opt/data/skills/a-own/new.md",
                 "/opt/data/cache/documents/gw393-sandbox-made.txt"):
        lines.append(f"{path}: {engine_file(path)}")
    return "\n".join(lines)


def check() -> None:
    show("after the reaper's teardown: the Engine's copies", check_lines())


def unreadable() -> None:
    """A file in A's cache the Engine's uid cannot read (made by run.sh as root, mode 000)."""
    show("5a A's command with an unreadable file in its cache",
         terminal(A, "a-unreadable", f"echo ran; ls {REMOTE}/cache/documents/; cat {REMOTE}/cache/documents/gw393-late.txt"))


def run_after() -> None:
    show("5 a Run after the teardown still works (A)", terminal(A, "a-after", "echo run-ok; cat /etc/hostname"))


def edit_again() -> None:
    """A fresh session edits the shared Skill again: for the variants (cap 0, read-only mount)."""
    show("4/5 A's fresh session: the shared Skill as uploaded",
         terminal(A, "a-shared-2", f"cat {REMOTE}/external_skills/0/shared-one/SKILL.md"))
    show("4/5 A edits the shared Skill and its own Skill again",
         terminal(A, "a-edit-2", "set -e; "
                  f"echo 'GW393 SHARED EDITED AGAIN' >> {REMOTE}/external_skills/0/shared-one/SKILL.md; "
                  f"echo 'GW393 A-OWN EDITED AGAIN' >> {REMOTE}/skills/a-own/SKILL.md; echo edited"))


def root_shared() -> None:
    """The launch profile (/opt/data, the one the reaper's sync-back resolves) also reads the shared folder."""
    status, body = probe.call("PUT", probe.MANAGE + "/api/config", {"config": {"skills": {"external_dirs": [SHARED]}}})
    print(f"launch profile: skills.external_dirs={SHARED} -> {status} {body[:60]}")


if __name__ == "__main__":
    provider.start(8080)
    {"setup": setup, "upload": upload, "check": check, "unreadable": unreadable,
     "run_after": run_after, "root_shared": root_shared, "edit_again": edit_again}[sys.argv[1]]()
