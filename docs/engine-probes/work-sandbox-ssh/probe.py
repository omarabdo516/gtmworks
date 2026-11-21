"""The probes, run inside the pinned Engine container. Prints one line per step.

Nothing here is gtmworks code: it drives the Engine's own management listener (9119) and Run API
(8642) exactly as lib/hermes.mjs does, with the fake model provider in provider.py scripting the
tool calls each probe needs.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/probe")
import provider  # noqa: E402

KEY = os.environ["API_SERVER_KEY"]
ENGINE = os.environ.get("PROBE_ENGINE_ADDRESS", "172.31.240.10")
MANAGE = f"http://{ENGINE}:9119"
RUNS = f"http://{ENGINE}:8642"
AGENT = "probe-agent"          # the tools the spec gives every Agent, with browser off
OPEN = "probe-open"            # every toolset on, for the inventory's attempts
OTHER = "probe-other"          # a second Agent, whose memory and Conversation are the targets
PROFILES = (AGENT, OPEN, OTHER)
KEYS = {name: (name.replace("-", "0") + "k")[:40].ljust(40, "k") for name in PROFILES}

# The tools the spec gives every Agent (its "Tools every Agent gets" line): web, vision, image
# generation, skills, the task list, memory, session search, the question tool, scheduled work,
# the terminal, files and code execution. Sub-agents are the Owner's switch, so off here.
AGENT_TOOLSETS = ["web", "vision", "image_gen", "skills", "todo", "memory", "session_search",
                  "clarify", "cronjob", "terminal", "file", "code_execution"]
ALWAYS_OFF = ["browser", "computer_use", "project", "desktop_ui", "catalog", "onboarding",
              "kanban", "connections", "video", "video_gen", "tts", "delegation"]
OPEN_TOOLSETS = AGENT_TOOLSETS + ["browser", "tts", "video", "video_gen", "delegation"]

records: list[dict] = []


def step(what: str, result: str, evidence: dict | None = None) -> None:
    records.append({"what": what, "result": result, "evidence": evidence or {}})
    print(f"{what}: {result}", flush=True)


def call(method: str, url: str, body=None, key: str = KEY, extra_headers: dict | None = None):
    headers = {"Authorization": "Bearer " + key, **(extra_headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()
    except Exception as error:  # noqa: BLE001 - a probe records the failure, it does not raise
        return 0, f"{type(error).__name__}: {error}"


def until(what: str, read, seconds: int = 240):
    for _ in range(seconds):
        found = read()
        if found:
            return found
        time.sleep(1)
    raise SystemExit(f"timed out waiting for {what}")


def model_config() -> dict:
    return {"provider": "custom", "default": "fake-model",
            "base_url": "http://127.0.0.1:8080/v1", "api_key": "fake-model-key",
            "context_length": 128000}


def make_profile(name: str, toolsets: list[str], disabled: list[str]) -> None:
    call("POST", MANAGE + "/api/profiles", {"name": name, "soul": f"The {name} probe profile."})
    call("PUT", MANAGE + f"/api/env?profile={name}", {"key": "API_SERVER_KEY", "value": KEYS[name]})
    status, body = call("PUT", MANAGE + f"/api/config?profile={name}", {"config": {
        "model": model_config(),
        "platform_toolsets": {"api_server": toolsets},
        "agent": {"disabled_toolsets": disabled},
        # The Run API is an unattended surface: without this every tool that needs a person's
        # approval is refused (tools/approval.py, approvals.unattended_mode).
        "approvals": {"unattended_mode": "approve"},
        # Speech output writes where the Agent says; a command provider needs no install, so the
        # probe can show the write instead of only the path check.
        "tts": {"provider": "probe", "providers": {"probe": {
            "type": "command", "command": "printf gw390-tts-audio > {output_path}"}}},
    }})
    assert status == 200, (status, body)

    until(f"the Run API for {name}",
          lambda: call("GET", f"{RUNS}/p/{name}/v1/capabilities", key=KEYS[name])[0] == 200)


def run(profile: str, probe: str, calls: list[dict], answer: str = "done",
        session: str | None = None) -> dict:
    """One Run whose fake model makes *calls*, one per model turn; returns the tool results."""
    provider.plans[probe] = {"calls": calls, "answer": answer}
    before = len(provider.log)
    headers = {"X-Hermes-Session-Key": session} if session else None
    status, body = call("POST", f"{RUNS}/p/{profile}/v1/runs",
                        {"input": f"PROBE {probe}\nPlease do the thing."}, key=KEYS[profile],
                        extra_headers=headers)
    if status not in (200, 202):
        return {"started": status, "detail": body[:300], "results": [], "tools": []}
    run_id = json.loads(body).get("run_id")
    state = "started"
    for _ in range(300):
        code, body = call("GET", f"{RUNS}/p/{profile}/v1/runs/{run_id}", key=KEYS[profile])
        try:
            state = json.loads(body).get("status") or state
        except Exception:  # noqa: BLE001
            pass
        if state in ("completed", "failed", "cancelled"):
            break
        time.sleep(1)
    entries = provider.log[before:]
    results = []
    if entries:
        # Each request carries the Run's whole history, so the longest one holds every tool
        # result; skip the results that were already there when this Run started (a shared
        # Engine session).
        seen = sum(1 for message in entries[0]["messages"] if message.get("role") == "tool")
        history = max(([str(m.get("content")) for m in entry["messages"] if m.get("role") == "tool"]
                       for entry in entries), key=len, default=[])
        results = history[seen:]
    try:
        output = json.loads(body).get("output") or ""
    except Exception:  # noqa: BLE001
        output = ""
    return {"started": status, "state": state, "results": results, "output": output,
            "tools": entries[0]["tools"] if entries else [], "entries": entries}


def tools_of(profile: str, probe: str) -> list[str]:
    answer = run(profile, probe, [])
    return answer["tools"]


def first_result(answer: dict, limit: int = 400) -> str:
    if not answer.get("results"):
        return f"no tool result (run {answer.get('state') or answer['started']})"
    return answer["results"][0][:limit].replace("\n", " | ")


def main() -> None:
    provider.start(8080)
    until("the management listener", lambda: call("GET", MANAGE + "/api/profiles")[0] == 200)

    make_profile(AGENT, AGENT_TOOLSETS, ALWAYS_OFF)
    make_profile(OPEN, OPEN_TOOLSETS, [])
    make_profile(OTHER, AGENT_TOOLSETS, ALWAYS_OFF)

    # The other Agent's own memory (written by its own memory tool) and a Conversation of its own:
    # the two things the inventory's attempts try to reach.
    answer = run(OTHER, "other-memory", [{"name": "memory", "arguments": {
        "target": "memory",
        "operations": [{"action": "add", "content": "GW390-PRIVATE-MEMORY another Agent wrote this"}]}}])
    step("0 another Agent's memory written by its own tool", first_result(answer, 200))
    status, body = call("POST", f"{RUNS}/p/{OTHER}/v1/runs", {"input": "PROBE other-session\nhello"},
                        key=KEYS[OTHER], extra_headers={"X-Hermes-Session-Key": "probe-other-1"})
    step("0 another Agent's private Conversation started", f"{status} accepted")

    # --- 1. The terminal, a background process, the file tools and code execution run in the
    # second container. Each writes its own marker under /tmp; run.sh then looks for it in the
    # sandbox and on the Engine's disk.
    marker = "gw390-terminal-" + str(os.getpid())
    answer = run(AGENT, "terminal", [{"name": "terminal", "arguments": {
        "command": f"id -un; hostname; echo {marker} > /tmp/gw390-terminal.txt; cat /tmp/gw390-terminal.txt"}}])
    step("1 terminal", first_result(answer))

    answer = run(AGENT, "background", [{"name": "terminal", "arguments": {
        "command": "sleep 5; echo gw390-background > /tmp/gw390-background.txt", "background": True}}],
        session="probe-background")
    step("2 background process started", first_result(answer, 200))
    time.sleep(7)
    answer = run(AGENT, "background-check", [{"name": "read_file", "arguments": {
        "path": "/tmp/gw390-background.txt"}}])
    step("2 the background process wrote its file", first_result(answer))

    answer = run(AGENT, "write-file", [{"name": "write_file", "arguments": {
        "path": "/work/gw390-file.txt", "content": "gw390-file from the file tool"}}])
    step("3 write_file", first_result(answer))
    answer = run(AGENT, "read-file", [{"name": "read_file", "arguments": {"path": "/work/gw390-file.txt"}}])
    step("3 read_file of what it wrote", first_result(answer))
    answer = run(AGENT, "write-outside-root", [{"name": "write_file", "arguments": {
        "path": "/tmp/gw390-outside.txt", "content": "written outside the work folder"}}])
    step("3 write_file outside the write-safe root", first_result(answer, 300))
    answer = run(AGENT, "read-sandbox-only", [{"name": "read_file", "arguments": {"path": "/work/sandbox-only.txt"}}])
    step("3 read_file of a file only the sandbox holds", first_result(answer))

    answer = run(AGENT, "code", [{"name": "execute_code", "arguments": {"code": (
        "import os, socket\n"
        "open('/work/gw390-code.txt','w').write('gw390-code from execute_code')\n"
        "print('host', socket.gethostname(), 'user', os.getuid())\n"
        "print(open('/work/gw390-code.txt').read())")}}])
    step("4 execute_code", first_result(answer))

    # --- 2. The pinned backend holds against a profile write and the Engine's settings routes.
    status, body = call("PUT", MANAGE + f"/api/config?profile={AGENT}",
                        {"config": {"terminal": {"backend": "local", "ssh_host": "127.0.0.1", "ssh_user": "root"}}})
    step("5 settings route: PUT /api/config terminal.backend=local", f"{status} {body[:120]}")
    answer = run(AGENT, "after-config", [{"name": "terminal", "arguments": {"command": "hostname; id -un; pwd"}}])
    step("5 command after that write", first_result(answer))
    stored = call("GET", MANAGE + f"/api/config?profile={AGENT}")[1]
    try:
        stored_terminal = json.loads(stored).get("terminal") or {}
    except Exception:  # noqa: BLE001
        stored_terminal = {}
    step("5 what the profile's config reports",
         f"backend={stored_terminal.get('backend')} cwd={stored_terminal.get('cwd')}")

    status, body = call("PUT", MANAGE + f"/api/env?profile={AGENT}",
                        {"key": "TERMINAL_ENV", "value": "local"})
    step("6 settings route: PUT /api/env TERMINAL_ENV=local", f"{status} {body[:120]}")
    answer = run(AGENT, "after-env", [{"name": "terminal", "arguments": {"command": "hostname; id -un"}}])
    step("6 command after that write", first_result(answer))

    # --- 2b. File delivery by path: the reply's own MEDIA:<path> tag, read by the Engine.
    import base64  # noqa: PLC0415
    import pathlib  # noqa: PLC0415
    cache = pathlib.Path(f"/opt/data/profiles/{OTHER}/cache/images")
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "probe.png").write_bytes(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
    answer = run(OPEN, "deliver-signin", [], answer="MEDIA:/opt/data/auth.json")
    step("8c delivery of the model sign-in by path", (answer.get("output") or "")[:160])
    answer = run(OPEN, "deliver-sandbox", [], answer="MEDIA:/work/image.png")
    step("8c delivery of a file only the sandbox holds", (answer.get("output") or "")[:160])
    answer = run(OPEN, "deliver-other-cache", [],
                 answer=f"MEDIA:/opt/data/profiles/{OTHER}/cache/images/probe.png")
    step("8c delivery of another Agent's cached image",
         f"{(answer.get('output') or '')[:60]} (data URL: {'data:image' in (answer.get('output') or '')})")

    # --- 3. With browser disabled and the terminal on, browser_exec is absent from the Run's tools.
    listed = tools_of(AGENT, "tools-agent")
    step("7 a Run's tools with browser off and the terminal on",
         f"{len(listed)} tools; terminal={'terminal' in listed}; browser_exec={'browser_exec' in listed}",
         {"tools": listed})
    opened = tools_of(OPEN, "tools-open")
    step("7 the same with browser on (control)",
         f"{len(opened)} tools; terminal={'terminal' in opened}; browser_exec={'browser_exec' in opened}",
         {"tools": opened})

    # --- 4. Every tool that runs code the Agent supplies, or reads or writes a path the Agent
    # names, in the Engine's own container: the attempt and its result.
    answer = run(OPEN, "browser-exec", [{"name": "browser_exec", "arguments": {"code": (
        "import os, socket\n"
        "open('/tmp/gw390-browser.txt','w').write('gw390-browser')\n"
        "print(socket.gethostname(), os.getuid())")}}])
    step("8 browser_exec", first_result(answer, 900))
    answer = run(OPEN, "browser-exec-reach", [{"name": "browser_exec", "arguments": {"code": (
        "for path in ('/opt/data/auth.json', '/opt/data/profiles/probe-other/memories/MEMORY.md'):\n"
        "    try:\n"
        "        print(path, '->', open(path).read()[:120])\n"
        "    except Exception as error:\n"
        "        print(path, '->', type(error).__name__)")}}])
    step("8b browser_exec reaching the sign-in and another Agent's memory", first_result(answer, 900))

    answer = run(OPEN, "tts", [{"name": "text_to_speech", "arguments": {
        "text": "a probe of the engine's speech tool", "output_path": "/tmp/gw390-tts.mp3"}}])
    step("9 text_to_speech to a file path of the Agent's choosing", first_result(answer))

    answer = run(OPEN, "tts-overwrite", [{"name": "text_to_speech", "arguments": {
        "text": "overwritten by the speech tool",
        "output_path": f"/opt/data/profiles/{OTHER}/memories/MEMORY.md"}}])
    step("9 text_to_speech onto another Agent's memory file", first_result(answer))

    answer = run(OPEN, "tts-signin", [{"name": "text_to_speech", "arguments": {
        "text": "overwritten by the speech tool", "output_path": "/opt/data/auth.json"}}])
    step("9 text_to_speech onto the model sign-in", first_result(answer))

    answer = run(OPEN, "vision-other", [{"name": "vision_analyze", "arguments": {
        "image_url": f"/opt/data/profiles/{OTHER}/memories/MEMORY.md", "question": "what is in this image?"}}])
    step("10 vision_analyze of another Agent's memory file", first_result(answer))

    answer = run(OPEN, "vision-signin", [{"name": "vision_analyze", "arguments": {
        "image_url": "/opt/data/auth.json", "question": "what is in this image?"}}])
    step("10 vision_analyze of the model sign-in", first_result(answer))

    answer = run(OPEN, "vision-other-home", [{"name": "vision_analyze", "arguments": {
        "image_url": f"/opt/data/profiles/{OTHER}/state.db", "question": "what is in this image?"}}])
    step("10 vision_analyze of another Agent's session store", first_result(answer))

    answer = run(OPEN, "vision-sandbox", [{"name": "vision_analyze", "arguments": {
        "image_url": "/work/image.png", "question": "what colour is this image?"}}])
    step("10 vision_analyze of an image in the sandbox", first_result(answer, 200))

    answer = run(OPEN, "video", [{"name": "video_analyze", "arguments": {
        "video_url": f"/opt/data/profiles/{OTHER}/state.db", "question": "what is in this video?"}}])
    step("11 video_analyze of another Agent's session store", first_result(answer))

    answer = run(OPEN, "image-gen", [{"name": "tool_call", "arguments": {"calls": [{
        "name": "image_generate", "arguments": {
            "prompt": "a probe",
            "image_url": f"/opt/data/profiles/{OTHER}/memories/MEMORY.md"}}]}}])
    step("12 image_generate (source path another Agent's memory)", first_result(answer, 300))

    answer = run(OPEN, "skill-traversal", [{"name": "skill_manage", "arguments": {
        "operations": [{"action": "create", "name": "../../probe-other/owned",
                        "content": "---\nname: owned\ndescription: probe\n---\nprobe\n"}]}}])
    step("13 skill_manage with a name that leaves the profile", first_result(answer))

    answer = run(AGENT, "tool-call-bridge", [{"name": "tool_call", "arguments": {
        "calls": [{"name": "browser_exec", "arguments": {"code": "print('should not run')"}}]}}])
    step("14 tool_call to browser_exec on the profile that has no browser", first_result(answer))

    answer = run(OPEN, "memory", [{"name": "memory", "arguments": {
        "target": "memory", "operations": [{"action": "add", "content": "gw390 memory probe"}]}}])
    step("15 memory", first_result(answer))

    answer = run(OPEN, "cronjob", [{"name": "tool_call", "arguments": {"calls": [
        {"name": "cronjob_manage", "arguments": {"action": "list"}}]}}])
    step("16 cronjob_manage list (scheduled work on the Engine)", first_result(answer, 300))

    # --- 5. A start folder per profile under the pinned backend.
    for name, folder in ((AGENT, "/work/ag-probe-agent"), (OPEN, "/work/ag-probe-open")):
        status, body = call("PUT", MANAGE + f"/api/config?profile={name}",
                            {"config": {"terminal": {"cwd": folder}}})
        answer = run(name, f"cwd-{name}", [{"name": "terminal", "arguments": {"command": "pwd; hostname"}}])
        step(f"17 {name} starts in its own folder", f"{status} {body[:80]} -> {first_result(answer)}")

    # --- 6. The Engine's listeners from inside the second container are probed by run.sh (it can
    # reach both containers); the answer is printed there with the other host-side checks.

    # --- 7. Does the screen start inside the sandbox over ssh?
    os.environ["HERMES_HOME"] = f"/opt/data/profiles/{OPEN}"
    import subprocess  # noqa: PLC0415
    started = subprocess.run(["/opt/hermes/.venv/bin/hermes", "computer-use", "screen", "start"],
                             capture_output=True, text=True, timeout=300,
                             env={**os.environ, "HERMES_HOME": f"/opt/data/profiles/{OPEN}"})
    step("19 screen start inside the second container",
         (started.stdout.strip() or started.stderr.strip())[:300].replace("\n", " | "))
    status = subprocess.run(["/opt/hermes/.venv/bin/hermes", "computer-use", "screen", "status", "--json"],
                            capture_output=True, text=True, timeout=120,
                            env={**os.environ, "HERMES_HOME": f"/opt/data/profiles/{OPEN}"})
    step("19 screen status", (status.stdout.strip() or status.stderr.strip())[:400].replace("\n", " "))

    with open("/opt/probe/records.json", "w", encoding="utf-8") as handle:
        json.dump(records, handle, indent=1)
    print("probe complete", flush=True)


if __name__ == "__main__":
    main()
