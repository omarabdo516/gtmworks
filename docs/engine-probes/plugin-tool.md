# Can a tool an Engine plugin registers know which person it works for? (#828, #829)

Yes. Measured on 2026-11-26 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, with the Engine's network closed to all but the fake model.

A plugin placed in the main Agent's profile folder in the Engine's data volume registers `gtmworks_make_agent`. The
install tells the plugin, through the plugin's own route on the management listener behind the Engine's key, that one
session is an Owner's. In that session the tool makes a profile from inside the Engine, and the new profile answers a
Run at once; in any other session it refuses with a reason the Agent can say. A Run's `tool.started` and
`tool.completed` events name the tool, in a Run started through the Run API and in a Kanban board worker's Run. The
Engine opens no connection to an install to do it. Two things the Lead tool spec must carry: the tool is **deferred**
behind the Engine's tool search unless the profile turns tool search off, and the plugin **loads at the next Engine
start**, not when its files land.

Run it again with `sh docs/engine-probes/plugin-tool/run.sh` (about five minutes): it stands up the throwaway Engine of
`docs/engine-probes/engine-stack/` (#823), places the plugin in `docs/engine-probes/plugin-tool/plugin/`, runs
`plugin-tool/probe.mjs`, prints the lines below and removes everything it made. A step that gets another answer than
the one below exits non-zero with the Engine's answer. The install's own backup and restore with the plugin in place
run apart, on a real install: `bash docs/engine-probes/plugin-tool/install-backup.sh` (section 8).

# 1. What the Engine answered

| Step | Answer |
| --- | --- |
| The Engine's network | `internal: true`, holding the Engine and the fake model only. A stand-in install on a network of its own, reached from inside the Engine: `OSError` (no route). Every row below ran this way. |
| Plugin placed in `/opt/data/profiles/lead/plugins/gtmworks-people`, `plugins.enabled: [gtmworks-people]` written to the profile's config, no restart | The route answers 200; the tool does not exist yet: `'gtmworks_make_agent' is not a known tool name` |
| After an Engine restart | the Run API lists toolset `gtmworks`, `enabled: true` |
| The plugin's route with no key / a wrong key | 401 `unauthenticated` / 401 `invalid_or_expired` |
| Mark `conversation-owner` (`POST /api/plugins/gtmworks-people/owner-sessions?profile=lead`) | 200 `{ok: true}` |
| A Run naming the tool directly | not offered: `Tool 'gtmworks_make_agent' does not exist. Available tools: … tool_call, tool_describe, tool_search …` |
| A Run in the Owner's session calling it through `tool_call` | events `tool.started gtmworks_make_agent`, `tool.completed gtmworks_make_agent error=false`; answer `{success: true, made: "ag-made"}` |
| The same in another session | events `tool.started gtmworks_make_agent`, `tool.completed gtmworks_make_agent error=true`; answer `{success: false, error: "Only an Owner of this Company can make an Agent. Ask an Owner to make it."}` |
| A Run on `ag-made` right after | `completed`, "the new Agent answers"; no restart |
| A board Card for `lead`, marked `card:<id>`, whose worker calls the tool | `{success: true, made: "ag-board"}` in the worker's session `local-87af8bb6…` |
| A Card not marked | `{success: false, error: "Only an Owner …"}` |
| After an Engine restart | both marks still listed; the tool succeeds in the Owner's session |
| After the Engine's container is removed and a new one started on the same volume (what an update does) | the tool succeeds; the plugin's files and its `data.db` are where they were |
| Take the mark off, call again (5 times) | refused on the first call every time, 254 ms at most from the route's answer to the refusal stored in the session; no call in between succeeded |
| `tools.tool_search.enabled: off` on the profile, the tool named directly | events name it, `{success: true}` |

# 2. What the handler is told

The dispatcher passes keyword fields a handler may declare (`tools/registry.py` `dispatch`, `model_tools.py`
`dispatch_kwargs`): `task_id`, `session_id` and `user_task`. That is the whole documented contract. The rest the probe's
handler read from the Engine's own scope:

| Field | A Run API Run | A board worker's Run |
| --- | --- | --- |
| `session_id` | the session gtmworks chose, `conversation-owner` | `local-<64 hex>`, made by the worker, not known before it starts |
| `task_id` | the session id | a fresh uuid |
| `user_task` | `null` | `null` |
| the profile (`hermes_constants.get_hermes_home()`) | `/opt/data/profiles/lead` | `/opt/data/profiles/lead` |
| the platform (`gateway.session_context.get_session_env`) | `HERMES_SESSION_PLATFORM: api_server`, `HERMES_SESSION_KEY: agent:lead:api_server:dm:<session>`, `HERMES_SESSION_USER_ID: api` | `HERMES_SESSION_SOURCE: kanban`, no platform |
| the Card | — | `HERMES_KANBAN_TASK: t_b2474e55`, `HERMES_KANBAN_BOARD: default` (the worker process's environment) |

So the tool decides by its session for a Conversation, and by its Card for a board worker, whose session the install
never sees beforehand. `gateway.session_context` is not a plugin surface: `plugins/AGENTS.md` says internal import
paths are not API, so reading the platform that way may break at a pin bump.

# 3. What offers the tool to each Run

- **The plugin is per profile.** A user plugin is found under the profile's own home (`<home>/plugins/<name>/`), so a
  plugin in `/opt/data/plugins/` reaches the default profile only, and the route answers `Plugin not found` for another
  one. It must also be in that profile's `plugins.enabled`: user plugins are opt-in (`hermes plugins list`: "only
  'enabled' plugins load").
- **Both Runs take a plugin's toolset by default.** A Run API Run takes the profile's `platform_toolsets.api_server`
  (default the `hermes-api-server` composite); a board worker takes the profile's `platform_toolsets.cli`, resolved at
  dispatch (`hermes_cli/kanban_db_dispatch.py`, `_resolve_worker_cli_toolsets`). A plugin toolset is on in both unless
  the saved list omits it after the Engine has recorded it as known (`hermes_cli/tools_config.py`,
  `_enabled_plugin_toolsets`).
- **It is deferred.** Every plugin tool is eligible for the Engine's tool search (`tools/tool_search.py`,
  `is_deferrable_tool_name`), so with `tools.tool_search.enabled: auto` (the default) a Run's own list holds
  `tool_search`, `tool_describe` and `tool_call`, and the model reaches the tool through `tool_call`. The events still
  name the tool itself. `tools.tool_search.enabled: off` on the profile puts it in the Run's own list, and every other
  deferred tool with it.
- **It loads at an Engine start.** The gateway reads plugins when it starts; a plugin's route is mounted on its first
  request without a restart.

# 4. Where it lives and what carries it

- The plugin: `/opt/data/profiles/<main Agent's profile>/plugins/gtmworks-people/`. What it was told:
  `/opt/data/profiles/<profile>/plugin-data/gtmworks-people/data.db` (`plugins/plugin_storage.py`; the install folder is
  replaced by `hermes plugins update`, so state never goes there). Both are in the Engine's data volume.
- **An Engine restart** keeps both (table, row "After an Engine restart").
- **`gtmworks update`** pulls the new Engine image and recreates the Engine's container on the same data volume
  (`scripts/install.sh`): a release's update replaces the image's own files (`/opt/hermes`) and never `/opt/data`. The
  probe did the same with the same pin (table, "a new one started on the same volume") and both stayed.
- **A backup and a restore** carry both. The install's own commands, on the install proof's own stack, ran in
  `docs/engine-probes/plugin-tool/install-backup.sh` (section 8): a source install made by the proof's helpers
  (`scripts/ci-install-lib.sh`), the plugin placed in the first Company's main Agent's profile and a session marked,
  `sh scripts/install.sh backup`, the install removed, a fresh install whose Engine held no profile at all, and
  `sh scripts/install.sh restore <archive>`. The archive held
  `engines/first/profiles/<profile>/plugins/gtmworks-people/…` and `…/plugin-data/gtmworks-people/data.db`; after the
  restore the plugin's files were back, its toolset was offered and its route listed the Owner's session it was told
  before the backup. (The proof's `remove_install` leaves the screen-driver container holding the Engine's volume, so
  the probe removes both before the fresh install; #850.)
- **How long a session stays an Owner's after the mark is taken off:** not at all. The tool reads the mark on every call,
  so the first call after the route answered is refused; the window is the route's own round trip.

# 5. Making the profile

The tool calls the Engine's own `hermes_cli.profiles.create_profile(name, soul)` and `seed_profile_skills`, the code
`POST /api/profiles` runs, which asks the live gateway to serve the new profile; it then writes the Engine's key into the
new profile's `.env` as `API_SERVER_KEY`, as `lib/hermes.mjs` does for every profile. The new profile answered a Run
started right after, with no restart and no wait. `hermes_cli.profiles` is not a `ctx` method either: a pin bump can move
it.

# 6. What this means for the Lead tool spec

- **Build Lead's tool as a plugin of the main Agent's profile**, its files in that profile's `plugins/` folder and its
  name in that profile's `plugins.enabled`, and restart the Engine once after placing it. The install places it at every
  Engine start (a release may change it), so it is the release's files, not a person's.
- **Tell it the person through its own route**, `POST /api/plugins/<name>/…?profile=<main profile>` with the Engine's
  key: a session when gtmworks starts a Conversation's Run (gtmworks already chooses the session id, Probe A), and a Card
  when a job is given on the board. Take the mark off when the person stops being an Owner: the next call is refused.
- **Keep what it was told in `plugin-data/`** of the profile, never in the plugin's folder.
- **Decide on deferral.** Either the Agent finds the tool with `tool_search` (the default; the events name it either
  way), or the profile sets `tools.tool_search.enabled: off` and pays for every deferred tool in each Run. The spec names
  which.
- **Read the session from `session_id`**, the documented field. Platform, profile and Card come from Engine internals
  (`gateway.session_context`, `hermes_constants`, the worker's environment) and from `hermes_cli.profiles` for making the
  profile: the spec lists them as the pin-bump check, and this probe is that check (`run.sh`).
- **Nothing else carries it.** The plugin and what it was told live in the Engine's data volume, so `gtmworks update`,
  `install.sh backup` and `install.sh restore` keep them with no step of their own (section 8).
- **Nothing reaches the install.** The tool needs no address, key or database of gtmworks; the Engine's network stays as
  ADR 0018 keeps it.

# 7. The run

```
engine image: nousresearch/hermes-agent:v0.23.0 (nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002)
run api: http://172.29.121.10:8642/health 200
management: http://172.29.121.10:9119/api/profiles 200
env file: /tmp/gtmworks-engine-stack/plugin-tool.env
engine nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
date 2026-11-26
network probe-plugin-tool-net: internal=true, holds probe-plugin-tool-engine, probe-plugin-tool-model
the Engine reaching an install stand-in at 172.19.0.2:8080: OSError
before an Engine restart: the route 200, the tool {"error":"'gtmworks_make_agent' is not a known tool name. Deferred tools must be invoked through tool_call by the exact name tool_search returns (e.g. mcp__<server>__{tool}). Use tool_search to find the exact name."}
after the restart: toolset gtmworks on the Run API: {"name":"gtmworks","enabled":true}
the plugin's route with no key: 401 {"error":"unauthenticated","detail":"Unauthorized","reason":"no_cookie","login_u
the plugin's route with a wrong key: 401 {"error":"session_expired","detail":"Unauthorized","reason":"invalid_or_expired_
mark conversation-owner: {"ok":true,"session_id":"conversation-owner"}
the tool named directly in a Run: events [], answer {"raw":"Tool 'gtmworks_make_agent' does not exist. Available tools: browser_exec, delegate_task, execute_code, manage_connections, memory, patch, read_file, search_files, skill_manage, skill_view, ski
Owner's session: events ["tool.started gtmworks_make_agent","tool.completed gtmworks_make_agent error=false"], answer {"success":true,"made":"ag-made"}
other session: events ["tool.started gtmworks_make_agent","tool.completed gtmworks_make_agent error=true"], answer {"success":false,"error":"Only an Owner of this Company can make an Agent. Ask an Owner to make it."}
what the handler was told: {"task_id":"conversation-owner","session_id":"conversation-owner","user_task":null,"hermes_home":"/opt/data/profiles/lead","HERMES_SESSION_PLATFORM":"api_server","HERMES_SESSION_CHAT_ID":"conversation-owner","HERMES_SESSION_USER_ID":"api","HERMES_SESSION_KEY":"agent:lead:api_server:dm:conversation-owner","HERMES_SESSION_ID":"conversation-owner"}
the profile the tool made: listed=true; a Run on it right after: completed "the new Agent answers"
board worker, Card marked: session local-87af8bb632349b58373c421d6f31ab5fb54a2930a104f9c2e3c050f78bce17ec, answer {"success":true,"made":"ag-board"}
board worker, Card not marked: answer {"success":false,"error":"Only an Owner of this Company can make an Agent. Ask an Owner to make it."}
what a board worker's handler was told: {"task_id":"23e44b03-2051-435b-9c37-63eb81b43a08","session_id":"local-87af8bb632349b58373c421d6f31ab5fb54a2930a104f9c2e3c050f78bce17ec","user_task":null,"hermes_home":"/opt/data/profiles/lead","HERMES_SESSION_SOURCE":"kanban","HERMES_SESSION_ID":"local-87af8bb632349b58373c421d6f31ab5fb54a2930a104f9c2e3c050f78bce17ec","HERMES_KANBAN_TASK":"t_b2474e55","HERMES_KANBAN_BOARD":"default"}
after an Engine restart: marks ["conversation-owner","card:t_b2474e55"], the tool {"success":true,"made":"ag-after-restart"}
after a new Engine container on the same volume: the tool {"success":true,"made":"ag-after-update"}; plugin files at /opt/data/profiles/lead/plugins/gtmworks-people: __init__.py dashboard marks.py plugin.yaml; marks in /opt/data/profiles/lead/plugin-data/gtmworks-people: data.db
ending: in 5 tries the first call after the mark was taken off was refused each time; the longest that call took from the route's answer to the refusal in the session: 254 ms, and no call in between succeeded
with tools.tool_search.enabled: off on the profile, the tool named directly: events ["tool.started gtmworks_make_agent","tool.completed gtmworks_make_agent error=false"], answer {"success":true,"made":"ag-eager"}
probe complete
```

# 8. The install's backup and restore

`bash docs/engine-probes/plugin-tool/install-backup.sh` (commit first: it runs HEAD; about 20 minutes, most of it the
install's image builds). It needs the ports a source install takes on `127.0.0.1` free.

```
install: nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002 as the first Company's Engine
main Agent's profile: co-4a386308ea6443a59e4a4f15c727a54d
mark a session through the plugin's route: {"ok":true,"session_id":"conversation-owner"}
before the backup: the plugin's toolset [('gtmworks', True)]; its marks {"sessions":[{"session_id":"conversation-owner","person":"owner-1","at":1795657191.3029134}]}
backup: 2869 entries; the plugin's entries:
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugin-data/gtmworks-people/
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugin-data/gtmworks-people/data.db
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugins/gtmworks-people/
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugins/gtmworks-people/__init__.py
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugins/gtmworks-people/plugin.yaml
  engines/first/profiles/co-4a386308ea6443a59e4a4f15c727a54d/plugins/gtmworks-people/marks.py
left after remove_install: gtmworks-screen-driver-first gtmworks-install_hermes 
a fresh, empty install: the main Agent's profile folder absent
after the restore: the plugin's files __init__.py dashboard marks.py plugin.yaml 
after the restore: the plugin's toolset [('gtmworks', True)]; its marks {"sessions":[{"session_id":"conversation-owner","person":"owner-1","at":1795657191.3029134}]}
probe complete
```

# 9. How the release places the plugin (#884)

The product's plugin is `lib/engine/gtmworks-plugin/` (plugin and toolset `gtmworks`, tool `gtmworks_make_agent`); the
worker keeps it in each main Agent's profile (`lib/main-agent-plugin.mjs`) through the Engine's own management listener
with the Engine's key, where the probe above used `docker cp`. Measured on the same pin on 2026-11-26, with a throwaway
Engine of `engine-stack/`:

| Step | Answer |
| --- | --- |
| Each file `POST /api/files/upload` to `<profile path>/plugins/gtmworks/<file>` (the path `GET /api/profiles` lists) | 200 `ok: true`, written as the Engine's own user; `GET /api/files/download` answers the same bytes, and 404 `Path not found` before |
| `PUT /api/config?profile=<profile>` `{plugins: {enabled: [gtmworks]}}` | 200; `GET /api/config` lists it under `plugins.enabled` |
| `GET /api/status` while no turn runs | `gateway_busy: false` |
| `POST /api/gateway/restart` | 200 `{ok: true, name: "gateway-restart"}`; the container is not restarted (same `StartedAt`, `RestartCount` 0), and 10 s later the profile's Run API lists toolset `gtmworks` enabled with `gtmworks_make_agent` |
| `platform_toolsets.api_server` written as gtmworks's fixed set with `gtmworks` beside it, before and after the plugin loads | 200; the toolset is offered once loaded, and the fixed set is unchanged |
| A Run in a marked session calling the tool through `tool_call` | `{success: true, profile: "ag-<32 hex>", name, speciality}`; the profile is listed with that `display_name` and `description`, its Run API offers exactly gtmworks's fixed set (copied from the main Agent's config, its own toolset left out), and it answers a Run at once |
| The same name again, in any case | `{success: false, error: "An Agent named … already exists. Choose another name."}` |
| A session nobody marked | `{success: false, error: "Only an Owner of this Company can make an Agent. Ask an Owner to make it."}` |

The install proof repeats it on a real install (`scripts/check-install-main-agent.mjs`): after the install and after
`gtmworks update` in the agents area, and across a backup and a restore in the backup area.
