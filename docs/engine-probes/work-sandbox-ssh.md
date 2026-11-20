# Does the pinned Engine run an Agent's work in a second container? (#390)

Yes. Measured on 2026-11-19 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`, the image `docker-compose.install.yml` pins, with the install's own work sandbox image beside it (`sandbox/Dockerfile`, built on `nousresearch/hermes-sandbox:desktop@sha256:df6768a595eaa09a9549237533421bf0557221ec0c13a825c9c202a13ddd37bb`).

The terminal, a background command, the file tools and code execution all act in the second container: each writes a
file that is found there and not on the Engine's disk. The `ssh` backend, address and key pinned in the Engine's
managed configuration hold against a profile write and against both settings routes. A start folder per profile works.
With `browser` off and the terminal on, `browser_exec` is absent from a Run's tools. The Engine's Run API and management
listener cannot be reached from the second container's network. The screen starts inside the second container over
`ssh`. Speech output writes on the Engine's own disk at a path the Agent names, so it stays off for every Agent.
No tool fails the proof with no safe setting.

What ADR 0018 assumes therefore holds, with three things the build must carry (section 5): the approval mode of the
unattended Run API surface, the file tools' write root, and the port and user of the sandbox's sshd.

# 1. How it was measured

- **The Engine** is the pinned image, unmodified, started as the install starts it (`hermes gateway run` under the
  image's s6 supervision) with its Run API on 8642 and the management listener on 9119.
- **The second container** is the install's own sandbox image, built from `sandbox/Dockerfile` (#392): the Engine's
  published sandbox image pinned by digest, plus `openssh-server`, the ordinary user `pn`, and `sshd` on port 2222 that
  takes a key that arrives at run time. Hermes publishes no ssh-ready sandbox image; its own build file says so
  ("when this image is the target of the ssh backend (sshd added on top)", `docker/sandbox-desktop.Dockerfile`).
- **The backend is pinned where ADR 0018 says**: `/etc/hermes/config.yaml` in the Engine's container, mounted read-only,
  holds `terminal.backend: ssh` with `ssh_host`, `ssh_user`, `ssh_port` and `ssh_key`. That is the managed scope
  (`hermes_cli/managed_scope.py`, `tools/terminal_scope.py`): it is applied last, after the profile's own config, so
  neither a profile nor a settings route can move it.
- **The key** is a pair made for this run; the private half is among the Engine's own files
  (`/opt/data/probe-ssh/id_ed25519`) and the public half reached the sandbox in `SSH_AUTHORIZED_KEY`.
- **The model** is a fake provider (`work-sandbox-ssh/provider.py`) inside the Engine container: it answers each chat
  completion with the tool calls the probe asks for and keeps every request it was sent. A Run is started on
  `/p/<profile>/v1/runs` with its own key, exactly as `lib/hermes.mjs` starts one.
- **Two networks**: `gw390-install` (the Engine, its install) and `gw390-sandbox` (the second container, and the
  Engine's second leg, because the Engine must dial `ssh` into it). Docker's own isolation keeps one bridge from
  reaching the other, and both Engine listeners are bound to the Engine's *install* address, so nothing listens on the
  address it has on the sandbox's network.
- **Three profiles**: `probe-agent` (the tools the spec gives every Agent, with `browser` off), `probe-open` (every
  toolset on, for the inventory's attempts), `probe-other` (a second Agent whose memory, a Conversation of its own and
  cache are what the attempts try to reach).
- **A stand-in model sign-in** sits where Hermes keeps it (`<home>/auth.json`, `hermes_cli/auth.py`) at
  `/opt/data/auth.json`, because the probe has no real sign-in and the attempts need a file to read. It holds a token,
  not a credential.
- **The work folder** is `/work` in the sandbox and `HERMES_WRITE_SAFE_ROOT=/work` in the Engine's own environment
  (section 5).
- **Every container runs under the shared heavy lock**, only when `free -g` shows at least 3 GB available, and the run
  removes every container, network, volume and image it made. It touches no other container.

# 2. What ran where

One line per probe, printed by `work-sandbox-ssh/probe.py` and `run.sh`; markers 20 to 22 are printed by `run.sh` from
the host, where both containers' disks can be read.

```
0 another Agent's memory written by its own tool: {"success": true, "done": true, "target": "memory", "usage": "2% — 45/2,200 chars", ...}
0 another Agent's private Conversation started: 202 accepted
1 terminal: {"output": "pn\n58cc01ccc6db\ngw390-terminal-337", "exit_code": 0, "error": null, "cwd": "/home/pn"}
2 background process started: {"output": "Background process started", "session_id": "proc_fe2f75a57804", "pid": 101, ...}
2 the background process wrote its file: {"content": "1|gw390-background", "total_lines": 1, ...}
3 write_file: {"bytes_written": 29, "dirs_created": true, "verified": true, "resolved_path": "/work/gw390-file.txt", ...}
3 read_file of what it wrote: {"content": "1|gw390-file from the file tool", ...}
3 write_file outside the write-safe root: {"bytes_written": 0, "error": "Write denied: '/tmp/gw390-outside.txt' is outside HERMES_WRITE_SAFE_ROOT (/work). ..."}
3 read_file of a file only the sandbox holds: {"content": "1|gw390-sandbox-only this file exists in the second container and nowhere else", ...}
4 execute_code: {"status": "success", "output": "host 58cc01ccc6db user 1000\ngw390-code from execute_code\n", "kernel": {"reused": false, "remote": true, ...}}
5 settings route: PUT /api/config terminal.backend=local: 200 {"ok":true}
5 command after that write: {"output": "58cc01ccc6db\npn\n/home/pn", "exit_code": 0, "error": null, "cwd": "/home/pn"}
5 what the profile's config reports: backend=ssh cwd=.
6 settings route: PUT /api/env TERMINAL_ENV=local: 200 {"ok":true,"key":"TERMINAL_ENV","config_updates":[]}
6 command after that write: {"output": "58cc01ccc6db\npn", "exit_code": 0, "error": null, "cwd": "/home/pn"}
8c delivery of the model sign-in by path: MEDIA:/opt/data/auth.json
8c delivery of a file only the sandbox holds: MEDIA:/work/image.png
8c delivery of another Agent's cached image: MEDIA:/opt/data/profiles/probe-other/cache/images/probe.png (data URL: False)
7 a Run's tools with browser off and the terminal on: 17 tools; terminal=True; browser_exec=False
7 the same with browser on (control): 20 tools; terminal=True; browser_exec=True
8 browser_exec: <untrusted_tool_result source="browser_exec"> | ... "workspace": "/opt/data/profiles/probe-open/cache/browser-use/workspace/run_c3892da9c3fa421b805d77aab7726f57"} | ...
8b browser_exec reaching the sign-in and another Agent's memory: {"success": true, "output": "/opt/data/auth.json -> {\"providers\":{\"openai\":{\"token\": \"gw390-...N-IN\"}}}\n\n/opt/data/profiles/probe-other/memories/MEMORY.md -> GW390-PRIVATE-MEMORY another Agent wrote this\n"}
9 text_to_speech to a file path of the Agent's choosing: {"success": false, "error": "output_path targets a protected credential or system path: /tmp/gw390-tts.mp3. ..."}
9 text_to_speech onto another Agent's memory file: {"success": false, "error": "output_path targets a protected credential or system path: /opt/data/profiles/probe-other/memories/MEMORY.mp3. ..."}
9 text_to_speech onto the model sign-in: {"success": false, "error": "output_path targets a protected credential or system path: /opt/data/auth.mp3. ..."}
10 vision_analyze of another Agent's memory file: {"success": false, "error": "Error analyzing image: sandbox returned non-image data for '/opt/data/profiles/probe-other/memories/MEMORY.md': Only base64 data is allowed", ...}
10 vision_analyze of the model sign-in: {"success": false, "error": "... sandbox returned non-image data for '/opt/data/auth.json' ..."}
10 vision_analyze of another Agent's session store: {"success": false, "error": "... sandbox returned non-image data for '/opt/data/profiles/probe-other/state.db' ..."}
10 vision_analyze of an image in the sandbox: {"success": true, "analysis": "..."}
11 video_analyze of another Agent's session store: {"success": false, "error": "Error analyzing image: image_url is required", ...}
12 image_generate (source path another Agent's memory): {"error": "'image_generate' is not available in this execution context. ..."}
13 skill_manage with a name that leaves the profile: {"success": false, "error": "... Invalid skill name '../../probe-other/owned'. ... batch aborted"}
14 tool_call to browser_exec on the profile that has no browser: {"error": "'browser_exec' is not available in this execution context. ..."}
15 memory: {"success": true, "done": true, "target": "memory", "usage": "0% — 18/2,200 chars", ...}
16 cronjob_manage list (scheduled work on the Engine): {"success": true, "count": 0, "jobs": []}
17 probe-agent starts in its own folder: 200 {"ok":true} -> {"output": "/work/ag-probe-agent\n58cc01ccc6db", ...}
17 probe-open starts in its own folder: 200 {"ok":true} -> {"output": "/work/ag-probe-open\n58cc01ccc6db", ...}
19 screen start inside the second container: Bot Desktop [probe-open]: running on DISPLAY :20 (1440x900)
19 screen status: {"blocker": null, "display": ":20", "geometry": "1440x900", "installed": true, "lease": {"holder": "agent"}, ...}
probe complete

20 where each marker a tool wrote is found
20 /tmp/gw390-terminal.txt: second container=yes engine=no
20 /tmp/gw390-background.txt: second container=yes engine=no
20 /work/gw390-file.txt: second container=yes engine=no
20 /work/gw390-code.txt: second container=yes engine=no
20 /tmp/gw390-browser.txt: second container=no engine=yes
20 /opt/data/profiles/probe-other/memories/MEMORY.mp3: second container=no engine=no
20 /work/sandbox-only.txt: second container=yes engine=no
20 another Agent's memory file after the speech attempt: GW390-PRIVATE-MEMORY another Agent wrote this
20 the model sign-in after the speech attempt: {"providers":{"openai":{"token":"gw390-STAND-IN-MODEL-SIGN-IN"}}}

21 the Engine's listeners, reached from the second container's network
21 Run API at 172.31.241.11:8642: ConnectionRefusedError
21 Run API at 172.31.240.10:8642: TimeoutError
21 management listener at 172.31.241.11:9119: ConnectionRefusedError
21 management listener at 172.31.240.10:9119: TimeoutError
22 the same two networks with a listener on 0.0.0.0 (control): open

probe finished; everything it made is removed
```

Rows are shortened to what they prove; the script prints them whole.

## The terminal, a background command, the files and the code (rows 1 to 4, 20)

Each wrote its own marker. `terminal` answered `pn`, host `58cc01ccc6db`, `cwd /home/pn` — the second container, as its
ordinary user. `execute_code` reported `remote: true` and the same host and user, which is `code_kernel_remote.py`'s
kernel inside the `ssh` backend, not a Python process on the Engine. The file tools wrote `/work/gw390-file.txt` and read
back a file that exists only in the second container. The background command outlived its tool call and wrote its marker
after it returned.

The host's own check (row 20) is the part that cannot be faked by a tool's answer: `/tmp/gw390-terminal.txt`,
`/tmp/gw390-background.txt`, `/work/gw390-file.txt` and `/work/gw390-code.txt` are on the second container's disk and on
none of the Engine's, and `browser_exec`'s `/tmp/gw390-browser.txt` is the other way round.

# 3. The pinned backend holds (rows 5 and 6)

Two writes, both answered `200 {"ok":true}`, and the command still ran in the second container:

| Attempt | What the Engine stored | Where the next command ran |
| --- | --- | --- |
| `PUT /api/config?profile=probe-agent` with `terminal.backend: local`, `ssh_host: 127.0.0.1`, `ssh_user: root` | the profile's config reports `backend=ssh` | `pn`, host `58cc01ccc6db`, `/home/pn` |
| `PUT /api/env?profile=probe-agent` with `TERMINAL_ENV=local` | accepted | `pn`, host `58cc01ccc6db` |

The managed scope is applied after the profile's own files (`tools/terminal_scope.py`, `build_profile_terminal_scope`),
so the write is kept and has no effect on where a command runs. Nothing in the engine's settings can put an Agent's
command back on the Engine's own disk.

# 4. What a Run is offered (rows 7, 8, 8c, 12, 13, 14, 15, 16)

- With `browser` in `agent.disabled_toolsets` and the terminal on: 17 tools, `terminal` present, `browser_exec` **absent**.
  With `browser` on, the same profile offers 20 tools including `browser_exec` — so the absence is the toolset switch and
  not the missing terminal. This matters because `browser_exec` is dropped from a session *only* when `terminal` is
  absent (`model_tools.py`, `_rewrite_browser_exec`): with the terminal on for every Agent, the browser toolset is the
  only thing that keeps it out.
- `tool_call` (the deferred-tool bridge) cannot reach a tool the session was not given: it answered
  `'browser_exec' is not available in this execution context`.
- File delivery by path in the reply (`MEDIA:<path>`) read nothing at all on the Run API: all three tags — the model
  sign-in, a file only the sandbox holds, another Agent's cached image — stayed literal in the Run's output. (The
  surface gtmworks does not use rewrites the tag into a data URL instead — `gateway/platforms/api_server.py`,
  `_resolve_media_to_data_urls`.)
- `skill_manage` refuses a name that leaves the profile (`Invalid skill name '../../probe-other/owned'`, batch rolled
  back), and `memory` and `cronjob_manage` act on the calling profile and its own Engine only.
- `image_generate` was not offered at all: it needs an image provider key the probe's Engine does not hold. Its source
  paths go through the same sandbox resolver as `vision_analyze` (`_confine_source_images`,
  `tools/image_generation_tool.py`), and its output lands in its own cache.

# 5. Every tool that runs code the Agent supplies, or touches a path the Agent names, in the Engine's own container

"Reach" is what the attempt showed it can get at: another profile's memory, the model sign-in, and a private
Conversation. The Conversation's store is the profile's `state.db` beside its `sessions/` folder.

| Tool (toolset) | What it does in the Engine's container | Attempt made | Result | Reach | What is done |
| --- | --- | --- | --- | --- | --- |
| `terminal` (terminal) | Shell through the terminal backend | `id -un; hostname; echo … > /tmp/…` | ran in the second container | none | in the fixed set; runs in the sandbox |
| background command (terminal) | Same, kept running after the call | `sleep 5; echo … > /tmp/…`, `background: true` | process started, wrote its file in the second container | none | in the fixed set; runs in the sandbox |
| `read_file`, `write_file`, `patch`, `search_files` (file) | Read/write through the terminal backend, bounded by `HERMES_WRITE_SAFE_ROOT` | wrote `/work/…`, read `/work/sandbox-only.txt`, wrote `/tmp/…` | wrote and read in the second container; `/tmp` refused, outside the write root | none | in the fixed set; runs in the sandbox, writes only under the work folder |
| `execute_code` (code_execution) | Python kernel in the backend, or on the Engine | wrote `/work/gw390-code.txt`, printed `host`, `uid` | kernel `remote: true`, the second container's host and user | none | in the fixed set, but refused unless the Run API surface may approve (see below) |
| `browser_exec` (browser) | Python in the Engine's own process | wrote `/tmp/gw390-browser.txt`; read `/opt/data/auth.json` and another Agent's `memories/MEMORY.md` | the Engine's container as uid 10000, writing in its own workspace `/opt/data/profiles/probe-open/cache/browser-use/workspace/…`; both files read whole | memory, sign-in, Conversation (any file) | **off for every Agent** (ADR 0018) |
| `vision_analyze` (vision) | Reads a media source the Agent names; media-cache paths on the Engine, everything else in the sandbox | asked for another Agent's memory file, the sign-in, its `state.db`, and an image in the sandbox | the three Engine files were not read — the read went to the sandbox and found nothing; the sandbox image was read and analysed | none | in the fixed set; safe as it is (`tools/image_source.py`) |
| `video_analyze` (video) | Same resolver, videos only | asked for another Agent's `state.db` | refused on its own arguments before any read (`image_url is required`) | none shown | **off for every Agent** (not in the fixed set) |
| `image_generate` (image_gen) | Reads source paths through the same sandbox resolver, writes its output into its own cache | called through the deferred-tool bridge with another Agent's memory as the source | not offered: no image provider key on the Engine | none shown | in the fixed set; its reads are sandbox-side, its writes stay in its cache |
| `video_generate`, `xai_video_edit`, `xai_video_extend` (video_gen) | Generate video, write into their cache | absent from the Run's tools (no provider key on the Engine) | not offered, so nothing was written | not measured | **off for every Agent** (not in the fixed set) |
| `text_to_speech` (tts) | Writes audio on the Engine's own disk at the path the Agent names | wrote `/tmp/…`, another Agent's `memories/MEMORY.mp3`, `/opt/data/auth.mp3` | with `HERMES_WRITE_SAFE_ROOT` unset (the image's default, the Engine's home) it wrote a sibling file in another Agent's memory folder and one beside the sign-in; with the root at `/work`, as `run.sh` starts the Engine, all three are refused | memory folder, sign-in's folder | **off for every Agent**: it acts on the Engine's disk, never in the sandbox |
| `skill_manage`, `skills_list`, `skill_view` (skills) | Read/write the profile's own skills on the Engine | create a skill whose name leaves the profile | refused by the name rule, batch rolled back | its own profile only | in the fixed set; safe as it is |
| `memory` (memory) | Write the profile's own memory on the Engine | add an entry | written to the calling profile only | its own profile only | in the fixed set; safe as it is |
| `session_search` (session_search) | Read the profile's own past sessions | (deferred tool, listed only) | — | its own profile only | in the fixed set; safe as it is |
| `cronjob_manage` (cronjob) | Schedule work on the Engine | list | `{"success": true, "count": 0}` | its own profile only | in the fixed set; safe as it is |
| `tool_call`, `tool_search`, `tool_describe` | Deferred-tool bridge | `tool_call` naming a tool the session lacks | refused: not available in this execution context | none | safe as it is (`tools/tool_search_validation.py`) |
| `delegate_task` (delegation) | A child Run in the Engine | not enabled here (the Owner's switch) | — | the parent's tools only; the Engine passes the disabled list to the child (`tools/delegate_tool_toolsets.py`) | the Owner's switch per Agent; off for an Agent without it |
| `computer_use` (computer_use) | Drives the screen inside the sandbox | the screen was started (row 19); the tool stays off | screen running at `:20` inside the second container | none | **off for every Agent** until the screen spec |
| `manage_connections`, `manage_catalog`, `kanban_*` (connections, catalog, kanban) | Act in connected accounts, install plugins, attach files from disk | absent from the Run's tools (`disabled_toolsets`) | not offered, so no reach was measured | not measured; `kanban_attach` takes a path and `manage_connections` acts in an account | **off for every Agent** (ADR 0018) |
| `read_terminal`, `close_terminal`, `desktop_preview`, `drive_preview`, `annotate_preview`, `focus_pane`, `gui_tour`, `show_tip`, `set_theme`, `react_to_message`, `read_window_below`, `desktop_project` (desktop_ui, project) | Desktop panes and project workspaces of a GUI session | not offered (disabled) | not offered | the Engine's own UI state | **off for every Agent** (ADR 0018) |
| `setup_beat` (onboarding) | First-run cards | not offered | not offered | none | **off for every Agent**, as today |
| `web_search`, `web_extract` (web) | Fetch pages over the network | — | — | none of the Engine's files | in the fixed set; the pages it reads cannot name a local path |

Three findings in that table change what the build must carry, and all three are settings rather than code:

- **The approval mode of the Run API surface.** `execute_code` was refused on the first attempt: *"This session runs on
  an unattended platform (api_server) with no user present to approve it… set approvals.unattended_mode"*
  (`tools/approval.py`). With `approvals.unattended_mode: approve` in the profile's config it ran, in the sandbox. Every
  Engine profile that serves gtmworks's Runs must carry it, or the Agent's code never runs.
- **The file tools' write root.** They write only under `HERMES_WRITE_SAFE_ROOT`, which the image sets to the Engine's
  home. Set in the Engine's own environment (`-e HERMES_WRITE_SAFE_ROOT=/work`, as `run.sh` starts it), every write lands
  in the sandbox's work folder and a write elsewhere is refused, and the same setting confines `text_to_speech`. Setting
  it through `PUT /api/env` for the profile does **not** move it — the tool reads the process environment — so it belongs
  in the Engine's service definition, beside the terminal keys.
- **The sshd contract** is `pn` on port 2222 with a key that arrives at run time, which is what `sandbox/Dockerfile`
  builds and what the Engine's managed `terminal` section pins.

# 6. The Engine's listeners from the sandbox's network (rows 21 and 22)

| Attempt, from inside the second container | Answer |
| --- | --- |
| Run API at the Engine's address on the sandbox network, `172.31.241.11:8642` | `ConnectionRefusedError` |
| management listener at the same address, `172.31.241.11:9119` | `ConnectionRefusedError` |
| Run API at the Engine's install-network address, `172.31.240.10:8642` | `TimeoutError` (no route between the two bridges) |
| management listener at the same address, `172.31.240.10:9119` | `TimeoutError` |
| control: the same two networks, a container holding a listener on `0.0.0.0:8642` | `open` |

The control is what makes the first four rows mean something: a container on both networks with a wildcard listener *is*
reachable from the sandbox, so the refusals come from where the Engine listens, not from the absence of a route. The
Engine is kept off the sandbox network's reach by binding both listeners to the install network's address at start
(`API_SERVER_HOST` and `HERMES_DASHBOARD_HOST`, the second read by the image's own dashboard service,
`docker/s6-rc.d/dashboard/run`), and by Docker's isolation of one bridge network from another. A wildcard bind — the
default, and what `docker-compose.install.yml` uses today — would answer on the address the sandbox can reach.

# 7. Can each profile start in a folder of its own? Yes

Row 17: `PUT /api/config?profile=<name>` with `terminal.cwd` set to `/work/ag-<name>` and the next command answered
`/work/ag-probe-agent` and `/work/ag-probe-open` — two profiles, two folders, in the same second container. The managed
scope pins the backend, the address and the key but not `cwd`, so a start folder per profile is a profile setting the
worker writes, not a change to the pinned backend. A relative or `~` path is left for the remote shell to expand
(`hermes_cli/config.py`, `_is_ssh_remote_tilde_cwd`, and `tools/terminal_tool_config.py`, `coerce_ssh_remote_cwd`), so it
must be written as an absolute path the sandbox holds.

# 8. Does the screen start inside the second container over `ssh`?

Yes, and nothing is built on it here. `hermes computer-use screen start` in the profile answered
`Bot Desktop [probe-open]: running on DISPLAY :20 (1440x900)`, and `screen status --json` reported `installed: true`,
`blocker: null`, `display: ":20"`, with the lease held by the agent — the launcher, Xvnc, Xfce and the RFB socket are in
the second container, which is what `tools/bot_desktop/placement.py` resolves for an `ssh` backend (`_STREAM_BACKENDS`).
The stream itself reaches a viewer through the Engine's management listener (`/api/display/ws`), which the next spec
builds on.

# 9. File sync: what the sandbox received, and the switch that turns it off

The `ssh` backend keeps a copy of the Engine's `~/.hermes` per sandbox at `/home/pn/.hermes`
(`tools/environments/ssh.py`, `file_sync.py`). Measured on 2026-11-20 by `work-sandbox-ssh/file-sync.sh`, whose full
output is `work-sandbox-ssh/file-sync-output.txt`:

- **Into the sandbox.** On connect the backend uploads the profile's Skills (the bundled ones and its own), the Company's
  shared Skills folder as `external_skills/<i>`, the profile's caches (documents, attachments, delegation and the rest in
  the same code list), and the profile's credential files (`iter_sync_files`, `get_credential_file_mounts`). No setting
  turns it off: `sync_files` is not reachable from a configuration, and no profile or environment variable gates it. Every
  profile of a Company uploads into the same `~/.hermes`, so one Agent's Skills and credentials would be readable by
  every other Agent of that Company.
- **Back to the Engine.** On cleanup the backend runs `sync_back()`. It maps remote paths by the *launch* home
  (`/opt/data`), so an Agent's edit to a Skill copy became an edit of the Engine's own `/opt/data/skills`, and a planted
  file landed beside it. The probe found `terminal.sync_back_max_bytes: 0` makes the extraction skip; that is a **size cap
  on the tar, not an off switch** — the upload still ran and the tar was still downloaded and thrown away.
- **The switch.** `SSHEnvironment(sync_files=False)` removes the `FileSyncManager` itself: nothing is copied in and
  nothing back. The pinned release never passes it (`tools/terminal_tool_backends.py`, `_build_ssh_env`), so gtmworks adds
  the upstream `terminal.ssh_sync_files` key at the Engine's start with a cont-init hook,
  `scripts/engine-ssh-sync-files.sh`, and sets it false in the managed configuration (`scripts/engine-managed.yml`). The
  hook fails the start if the pinned text moved, so a pin bump cannot silently drop it; the image stays the pinned
  official one. With it off an Agent sees only the Company's work folder, and a Run still works (the install job proves
  both, and that no credential file of the Engine's profiles is in the sandbox).

# 10. Tools that fail the proof with no safe setting

None. Every tool that runs the Agent's code or touches a path it names in the Engine's own container is either confined
to the sandbox by the pinned backend and the write root, or is off for every Agent — and the two that stay off because of
this proof, `browser_exec` and `text_to_speech`, are not in the tools the spec gives every Agent.

# Running it again

```sh
sh docs/engine-probes/work-sandbox-ssh/run.sh          # runs, prints, removes everything it made
KEEP=1 sh docs/engine-probes/work-sandbox-ssh/run.sh   # leaves the containers and the work dir for inspection
```

The script takes the shared heavy lock (`/home/t3/.cache/gtmworks-378-SbxosC/heavy.lock`), refuses to start below 3 GB
available, builds `sandbox/Dockerfile` (the work sandbox image), and removes every container, network, volume and image
it made. It needs Docker and the two pinned images; the build is a few minutes the first time.

| File | What it is |
| --- | --- |
| `work-sandbox-ssh/run.sh` | the whole environment: networks, key, the sandbox, the Engine, the probes, the host-side checks, the teardown |
| `work-sandbox-ssh/probe.py` | the probes, run inside the pinned Engine container against its own listeners |
| `work-sandbox-ssh/provider.py` | the fake model provider that scripts each Run's tool calls and keeps every request |
| `work-sandbox-ssh/reach.py` | the connection attempts from inside the second container |
| `work-sandbox-ssh/managed-config.yaml` | what the Engine's managed scope pins: `ssh` backend, address, user, port, key |
| `work-sandbox-ssh/file-sync.sh` | the file-sync probe (#393): the same environment, with the Engine variants of section 9 |
| `work-sandbox-ssh/file-sync.py` | the probes the file-sync run makes: the sandbox's `~/.hermes`, the Skill edits, and what the Engine kept |
| `work-sandbox-ssh/file-sync-output.txt` | the full output of the file-sync probe's final run |

Both scripts take the same shared heavy lock and remove everything they made; the file-sync probe also takes the
install's managed configuration as it ships, so a change to `scripts/engine-managed.yml` is what it measures.
