# What the Engine's own Kanban board does for gtmworks (#833, spec #831)

Measured on 2026-11-26 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, with a fake OpenAI-style model whose answers a script chose.
This first pass ran the Engine alone, with its terminal on its own disk (`local` backend), to learn the board's
routes and its lifecycle; the Work-sandbox steps (the `ssh` backend, the start folder, the files) are proven by the
install proof's Kanban check (`scripts/ci-install-check.sh`, open-design area), and its results are added below.

Sources read in the image: `plugins/kanban/dashboard/plugin_api.py` (the routes), `hermes_cli/kanban_db*.py` (states,
review reopen), `hermes_cli/kanban_db_dispatch.py` (the worker's spawn), `tools/kanban_tools*.py` (the Agent's tools
and when they are offered), `model_tools.py` and `hermes_cli/tools_config.py` (toolset selection),
`tools/approval_detection.py` (what is dangerous).

## 1. The routes, on the management listener

All under `/api/plugins/kanban`, behind `Authorization: Bearer <the Engine's key>` (the dashboard's own credential, which the
install sets to the Engine key). With no `?board=` every route is the Engine's default board.

| Route | What it does |
| --- | --- |
| `GET /board` | `{columns:[{name,tasks}] for triage, todo, scheduled, ready, running, blocked, review, done, tenants, assignees, latest_event_id, now}`; archived Cards are left out |
| `GET /tasks/{id}` | `{task, comments, events, attachments, links:{parents,children}, link_tasks, child_results, runs}` |
| `POST /tasks` | body `{title, body?, assignee?, tenant?, priority?, parents?, triage?, idempotency_key?, …}`; with an assignee and no `triage` the Card is `ready` |
| `PATCH /tasks/{id}` | any of `{title, body, assignee ("" clears), status, priority, summary, result, metadata, block_reason}`; `status` `running` is refused (400), `archived` archives, `done` completes with `summary`, `ready` from `blocked` unblocks, `ready` from `review` reopens to the implementer |
| `POST /tasks/{id}/comments` | `{body, author}`: `author` is free text, so gtmworks writes the person's name |
| `POST /links`, `DELETE /links?parent_id&child_id` | a Card waits for its parent until the parent is done or archived |
| `GET/POST /tasks/{id}/attachments`, `GET/DELETE /attachments/{id}` | a person's file on a Card |
| `POST /runs/{run}/terminate`, `POST /tasks/{id}/reclaim` | stop the open Run |
| `POST /dispatch?max=N` | one dispatcher tick now; answers what it spawned, reclaimed, crashed, blocked |
| `DELETE /tasks/{id}` | deletes for good: gtmworks never calls it (spec #831) |
| `GET /events` (WebSocket, ticket) | the board's event stream (docs/engine-probes/engine-dashboard.md) |

## 2. The lifecycle, step by step

| Step | What the Engine answered |
| --- | --- |
| `POST /tasks` with `assignee: alpha` | `status: ready`, `created_by: dashboard`; nothing runs yet |
| `POST /dispatch` | 0.4 s; `spawned: [[id, alpha, /opt/data/kanban/workspaces/<id>]]`; the worker's first model call came within seconds. No Run is started by the caller: the dispatcher claims the Card (`claimed`, `spawned`, `owner_admitted`, `worker_bound` events) and the worker runs in the gateway as a session of source `kanban` |
| The worker's first prompt | `# Kanban task <id>: <title>`, assignee, status, workspace, `## Body`, prior attempts with their errors, comments |
| The worker's tools | its profile's toolsets plus every `kanban_*` lifecycle tool (`kanban_block`, `kanban_comment`, `kanban_complete`, `kanban_create`, `kanban_request_review`, `kanban_show`, attachments, links); the orchestrator tools (`kanban_list`, `kanban_unblock`) are not a worker's |
| A worker that answers in plain text only | the Engine tells it twice that a plain reply is not a board state; then the Card counts a failure |
| `kanban_block(reason)` | `status: blocked`, the Run's outcome `blocked` with the reason as its summary |
| `POST /comments {author: "Omar Abdo"}`, then `PATCH status: ready`, then `POST /dispatch` | `commented`, `unblocked`, a new Run; its prompt holds the comment under the author's name |
| `kanban_request_review(summary)` | `status: review`, Run outcome `review_requested` with the summary |
| `POST /dispatch` on a Card in `review` | a reviewer Run on the same profile, its prompt preloaded with the Engine's bundled `sdlc-review` skill; it passes with `kanban_complete` or returns with `kanban_request_changes(reason)` |
| The reviewer's `kanban_request_changes(reason)` | `status: ready`, outcome `changes_requested` with the reason; the next dispatch reruns the implementer, whose prompt holds the reason |
| A person's return: `POST /comments` (the reason), then `PATCH status: ready` | `review_reopened`, assignee restored to the implementer from the `review_requested` event; the HTTP move itself takes no reason, so the reason is the comment |
| A person's pass: `PATCH status: done, summary` | `completed`; the Run's summary is the one sent, so gtmworks keeps the worker's summary and adds the line naming the person |
| A Card in `triage` (`triage: true`, no assignee), two dispatcher ticks | the Engine's decomposer called the model through the auxiliary slot `kanban_decomposer`, which resolves to the main model of the Engine's default profile (`custom`/`fake-model` here); a reply that is not a plan leaves the Card in `triage` |

## 3. A dangerous command in a worker's Run

A worker's Run is single-query (`-q`). Hermes flags `rm -rf /tmp/…` as `delete in root path`
(`tools/approval_detection.py`). With the default `approvals.single_query_mode: deny` the command is refused:
`BLOCKED: Command flagged as dangerous (delete in root path) but single-query mode (-q) runs without a user present to
approve it`. With `approvals.single_query_mode: approve` in the managed config (`/etc/hermes/config.yaml`) it runs,
exit 0. The setting goes in `scripts/engine-managed.yml`, which no profile write changes.

## 4. The Kanban tools in a Run started through the Run API

- A profile's `agent.disabled_toolsets` is applied last, also to a board worker (`model_tools._select_tool_names`), so
  gtmworks's own list of tools no Agent gets (`lib/agent-toolsets.mjs`, `noAgentGets`) had kept `kanban` off every
  worker as well as every Conversation.
- With `kanban` named in a profile's `platform_toolsets.api_server` and not disabled, `GET /p/<profile>/v1/toolsets`
  lists `kanban` enabled, and a Run's model is offered `kanban_create`, `kanban_list`, `kanban_show`, `kanban_comment`,
  `kanban_link`, `kanban_unblock` and the lifecycle tools.
- It cannot be a managed-config setting: the managed scope replaces a list it names, so `platform_toolsets.api_server`
  there would erase each Agent's own toolsets (sub-agents, its Apps). It is a setting of every profile instead, written
  by the worker as every other toolset is (`toolConfig`), in ADR 0022's order still a setting.
- An Agent (gamma) asked in a Run API Run to give a job to another Agent (delta) called
  `kanban_create({title, body, assignee: "delta"})`: the Card was made `ready`, `created_by: gamma`, and the answer said
  `subscribed: true`.

## 5. Whether the Agent that made a Card learns its result

Yes. The Engine subscribes the creating session, and its notifier wakes that session on the Card's events: the log
read `kanban notifier: woke agent for <id> on api_server/<session> profile=gamma events={'review_requested'}`, and the
creating session's next model call held a user turn `[kanban] Task <id> handed off for review; the implementation is
done. Title: … Assignee: @delta … Result: <summary>`. It also woke on `crashed`.

## 6. Notes for the install

- A profile folder writable by another user is refused by the worker's owner check
  (`unsafe_control_permissions … chmod go-w`); profiles made through `POST /api/profiles` are `drwxr-xr-x`.
- A Run API request for a named profile needs that profile's own `API_SERVER_KEY`; the install already writes it.
- A reviewer Run on a profile made with `no_skills` exited before the model (`Kanban owner refused: Kanban execution
  unknown`) in the hand run. Every Agent profile gtmworks makes keeps the bundled Skills, and on the real Engine the
  review ran on one: Card B's reviewer, on the second Agent's profile, passed it (section 8, "The first green run").

## 7. The settings the install writes

| Setting | Where | Why |
| --- | --- | --- |
| `approvals.single_query_mode: approve` | `scripts/engine-managed.yml`, mounted read-only at the managed scope (`/etc/hermes/config.yaml`) of every Company's Engine, the first one's, one `gtmworks company add` makes and one `gtmworks update` brings up | a worker's Run is single-query (`gateway/session_kanban.py`) and refuses a dangerous command by default (section 3). The managed scope is applied per leaf after a profile's own config, so a profile's `approvals.unattended_mode` stays its own and a profile's write of `single_query_mode: deny` changes nothing |
| `kanban` offered, never disabled | every profile's `platform_toolsets.api_server`, written by the worker (`lib/agent-toolsets.mjs`, `everyAgentGets`), no longer in `noAgentGets` | the Kanban tools are offered to Runs started through the Run API, and a board worker keeps its lifecycle tools (section 4). It cannot be a managed setting, which would replace each Agent's whole list. A child Run never gets it: the Engine keeps `kanban` from sub-agents (`childToolsets`) |
| `kanban.dispatch_in_gateway`, `kanban.review_dispatch`, `kanban.dispatch_interval_seconds` | not written | the dispatcher and the review dispatch stay on, every 60 s, as Hermes ships them |
| `TMPDIR: /opt/data/cache/scratch` | the Engine service's environment in `scripts/engine-template.yml`, so every Engine an install makes or updates has it; the Engine's start makes the folder before the gateway | a worker's ssh control socket otherwise lands under its profile's scratch, past a Unix socket's 108 bytes (section 8, "A worker's first command") |

Why the board's tools pass ADR 0020's rule that no tool reads a path an Agent chooses on the Engine: `kanban_attach`
takes the file's bytes, not a path, and a declared artifact (`kanban_complete` and `kanban_request_review`'s
`artifacts`) is copied into the Card's attachments only from the Card's own scratch folder on the Engine; any other
path stays a string (`hermes_cli/kanban_db.py`, `_persist_scratch_completion_artifacts`). The notifier's upload of a
declared path goes through the gateway's own delivery check (`gateway/platforms/base.py`,
`filter_local_delivery_paths`), and a Run API session has no messaging platform to upload to.

## 8. The install proof's Kanban check

One step of the open-design area, `kanban` (`scripts/check-install-profiles.mjs`, run from
`scripts/ci-install-check.sh` after every Open Design check), on the pinned Engine with the fake model, the Work
sandbox's `ssh` backend and the first Company's two Agents: the area makes the second Agent for it with the `second`
step, as agents-sandbox does. No CI job is added. The job reads the host's Docker for where the worker's files landed,
which a tool's own answer cannot fake.

It first ran at the end of agents-sandbox, which had used about 8.5 of its 12 minutes when the step began; on run
45841934073 the step printed nothing and the job was cancelled at its limit four minutes later. open-design used 5 of
its 12 minutes on the same run, and the second Agent takes about one more.

| Acceptance criterion of #833 | Where the check holds it |
| --- | --- |
| A Card made through the Kanban routes and given to an Agent is started by the dispatcher after one tick, no Run started by the check | `POST /tasks` with the second Agent's profile, then one `POST /dispatch` that ran (asked again only while another tick holds the board's lock and answers `skipped_locked`, having done nothing); the Card's first Run, on that profile, within 30 s. The step's only Conversation is the main Agent's, for Card B |
| The worker leaves a file in the Work sandbox and nothing on the Engine's disk outside its Kanban folders | the worker's `terminal` writes `/work/<marker>-card.txt`; the job reads it from the sandbox, compares the hostname the command printed with the sandbox's, and finds no file of the marker's name on the Engine outside `/opt/data/kanban` and the read-only `/opt/data/work` |
| The worker stops on a question, and after a comment and a move to ready its next Run reads the comment and goes on | `kanban_block`, then `POST /comments` under the person's name and `PATCH status: ready`; the next Run's prompt holds the answer under that name and it sends the work for review |
| Review: a pass ends the Card done with its summary, a return puts it back to the same Agent | the person's return: the reason as a comment, then `PATCH status: ready`, read back `ready` on the same Agent, whose next Run reads the reason; the pass: `PATCH status: done` with the worker's summary and the line naming the person |
| A dangerous command runs in a worker's Run and is not refused | `rm -rf /tmp/<marker>-danger/gone` after the profile wrote `single_query_mode: deny`: exit 0 and no refusal, and the job finds the folder gone in the sandbox |
| An Agent in a Run API Run makes a Card for another Agent, and whether its session is told | the main Agent's Conversation calls `kanban_create` for the second Agent: `created_by` is the main Agent's profile; the Card is worked and the Engine's reviewing Agent passes it by itself; the proof prints `told` |
| What a Card in `triage` does in two dispatcher ticks, and the decomposer's model | a Card with `triage: true` and no Agent, made first and read once the decomposer was called twice (at most 125 s, then up to 5 s for the Card to leave triage); the proof prints its status, its children, and the model each decomposer request named |
| The settings are in a new Company's Engine and one `gtmworks update` brought up, and a profile's write does not change them | `engine_board_settings` (`scripts/ci-install-lib.sh`) on every Engine of the open-design area, the second Company's included, and after the update in the update and engines-update areas; the profile's own `deny` above |
| No CI job is added | the check is one step of the open-design area (`tests/ci-install.test.mjs`) |

A person's return while the Engine's own tick has started a reviewing Agent on the Card: `PATCH status: ready` from
`running` keeps the Card in review (`_set_status_direct` resumes a reviewer's Run to `review`), so the check first stops
the reviewer's Run (`POST /tasks/{id}/reclaim`) and prints what the Card was after it (`reviewer_stopped`). A pass
(`PATCH status: done`) is forced over an open Run and needs no stop.

### A worker's first command

On the real Engine (CI run 45854207378, the `"step":"kanban"` lines of install-open-design) a board worker's first
command failed: `SSH connection failed: unix_listener: path
"/opt/data/profiles/ag-<32 hex>/cache/scratch/hermes-ssh/<16 hex>.sock.<16 random>" too long for Unix domain socket`.
The ssh backend keeps its ControlMaster socket in `tempfile.gettempdir()/hermes-ssh` (`tools/environments/ssh.py`). A
worker runs re-homed to its Agent's profile, and `hermes_constants.apply_scratch_tmp_env` points `TMPDIR` at that
profile's `cache/scratch` unless a temp variable is already set ("a temp var the user set is respected"). A profile's
name is 35 characters (`ag-` or `co-` and 32 hex), so the socket's path is about 118 bytes, past Linux's 108. A
Conversation's commands worked because they run under the root profile's scratch.

The fix is ADR 0022's first rung, a setting: the Engine service's environment sets `TMPDIR=/opt/data/cache/scratch`,
the root profile's own scratch, which the gateway already used, so Conversations keep their folder and only the
workers move; the socket's path under it is about 73 bytes. A fresh volume has no `cache/scratch` and Python's
`tempfile` passes over a `TMPDIR` that is not there, so the Engine's start makes it, `0700` and the Engine's user's,
before the gateway (measured on the pinned image: `hermes:hermes`, and `tempfile.gettempdir()` returns it). The lead's
hand-run pinned Engine with `TMPDIR` set put the worker's control folder there. A Card's workspace and attachments are
under the board's own folders (`hermes_cli/kanban_db.py`, `workspaces_root`), not the temp folder, so they do not move.

`engine_board_settings` asks every Engine the proof checks, as the Engine's user, for a `TMPDIR` that is there,
writable and at most 50 characters, Hermes's own budget for a temp root that holds sockets (`SOCKET_TMPDIR_MAX_LEN`),
so a later change to the template cannot drop it; `tests/bundled-hermes.test.mjs` pins the value and the start step.

### Its time

The step has 270 s of its own (`stepClock`, `lib/install-proof.mjs`) and prints one line,
`{"step":"kanban","seconds":…,"phase":"…"}`, as each phase ends, so a timeout shows how far it got. Every wait takes
the seconds it names or what is left of the 270, whichever is less, and each request to the board gives up after 20 s;
past the budget plus 20 s the step ends itself. A failure prints `"phase":"failed"` with the error and each Card as the
board reads it (status, Agent, each Run's profile, status and outcome, the last eight events' kinds), before the job
prints the Engine's own board log.

Three things run side by side from the step's start, since the triage Card's two ticks are the Engine's own: the
decomposer runs only on the dispatcher's own tick (`gateway/kanban_watchers.py`, `auto_decompose_tick`), never on
`POST /dispatch`, which runs `dispatch_once` alone. Card A, the person's; Card B, from the main Agent's Conversation
once Card A has started; and the triage Card. The first to fail fails the step. Every other wait is on a tick the step
asks for, never on the Engine's 60 s one. The fake model tells a board session's own Card by its prompt's header line,
`# Kanban task <id>: <title>`: the prompt also lists the Agent's recent work on its other Cards
(`hermes_cli/kanban_db_context.py`, `_ctx_role_history`), and Card A and Card B are each in the other's.

The fake model (`lib/install-kanban.mjs`) reads only a session's user turns. Hermes's system prompt lists the bundled
Skills, `sdlc-review` among them, for every session, so on run 45849314052 a script that read it took every board
worker for a reviewer: Card A's worker waited for the person, as Card A's reviewer does, until its 90 s were spent with
no tool called, and Card B's worker passed its own Card in one Run whose outcome was `completed`, which the check then
counted green. A reviewer is told in its own first user turn: the review dispatch preloads `sdlc-review`
(`hermes_cli/kanban_db_dispatch.py`, `gateway/session_kanban.py`), and the prompt opens with the preloaded skill's
line, `[IMPORTANT: The user launched this CLI session with the "sdlc-review" skill preloaded. …]`
(`agent/skill_commands.py`, `build_preloaded_skills_prompt`), before the Card's header. The check now holds each review
by the Card's Runs, not its latest summary: sent for review only once a Run ended `review_requested` with the worker's
summary, and passed only on a later Run that ended `completed` (Card B's reviewer, Card A's person).

| Phase | Its deadline | Expected on the fake model |
| --- | --- | --- |
| Both Agents on the fake model, their toolsets read | (requests) | about 2 s |
| The triage Card, the profile's `deny` write, Card A made with no Run | (requests) | under 1 s |
| One tick, Card A's first Run | 15 s for a tick that ran, 30 s for the Run | 1 to 5 s |
| Card A's two commands in the sandbox, then blocked | 90 s | 10 to 30 s: a worker spawn, three model calls, two commands over ssh |
| The answer, a tick, Card A sent for review | 90 s | 10 to 20 s |
| The return (a reviewer the Engine's own tick started is stopped first, 30 s), a tick, Card A sent for review again | 90 s | 10 to 20 s |
| The pass, Card A done | 20 s | under 2 s |
| Card B, beside Card A: the Conversation's send and reply | 60 s and 90 s | 5 to 15 s |
| A tick, Card B sent for review; a tick, the reviewing Agent passes it | 90 s each | 10 to 20 s each |
| The main Agent's session told | 20 s | 0 to 5 s: the notifier polls every 5 s and wakes it on the review request already |
| The triage Card after two of the Engine's own ticks | 125 s from its making, then 5 s | 60 to 125 s, then 5 s |

So the step takes about 130 s, set by the triage Card's two ticks while both Cards finish inside them, and 270 s at
most; with the second Agent (about 66 s on run 45841934073) the open-design area grows from 5 to about 8.5 minutes, and
to 11 at the worst.

The proof prints one line, `{"step":"kanban",…,"board":{…}}`, in the open-design log (`kanban-proof.log`): the
Card, whether the tick the check asked for spawned it, the seconds to its first Run, the Agent a return went back to,
Card B's maker, Agent, `subscribed`, `told`, the triage Card's status and children, and the decomposer's calls and
models.

### The first green run

CI run 45860369833 on commit 5d979d5, 2026-11-26, job install-open-design (green, 8 minutes 9 s; the `second` step
took 64 s). The step took 120 s, set by the triage Card; seconds below are from the step's start.

| Acceptance criterion of #833 | What the real Engine answered |
| --- | --- |
| Started by the dispatcher after one tick, no Run started by the check | the one tick spawned Card A (`spawned_by_tick: true`) and its first Run started at 0 s; Card B's tick spawned it at 2 s |
| A file in the Work sandbox, nothing on the Engine's disk | the worker's command printed the sandbox's hostname and `pwd` `/work/ag-<32 hex>`: a remote worker starts in its Agent's own folder of the work folder. The job read `/work/<marker>-card.txt` in the sandbox and found nothing of the marker's name on the Engine outside its Kanban folders |
| Blocked on a question, the comment read, goes on | blocked after its two commands at 8 s; after the comment, the move to ready and a tick, its next Run read the answer and sent the work for review at 16 s |
| Review: pass done with the summary, return to the same Agent | the person's return at 16 s put Card A `ready` on the same Agent (`returned_to` the second Agent's profile; no reviewer to stop, `reviewer_stopped: false`); its next Run read the reason and sent it again at 22 s; the person's pass made it `done` at 22 s. Card B's review ran on the second Agent's profile, which gtmworks made with the bundled Skills kept, and the reviewing Agent passed it, `done`, at 17 s |
| A dangerous command runs | `dangerous: ran` after the profile's own `single_query_mode: deny`, and the job found the folder gone in the sandbox |
| A Run API Agent makes a Card for another, and whether its session is told | Card B `created_by` the main Agent's profile (`co-<32 hex>`), assignee the second Agent, `subscribed: true`; `told: true` at 17 s, when the reviewing Agent passed it |
| A Card in `triage` in two ticks, the decomposer's model | after two of the Engine's own ticks (120 s) the Card is still `triage` with no children; the decomposer called the model twice, both `fake-model`, the default profile's main model |
| The settings in a new Company's Engine and an updated one, not changed by a profile | `engine_board_settings` held on every Engine of open-design, the second Company's included, and the install-update and install-engines-update jobs of the same commit are green |
| No CI job is added | the check ran as a step of install-open-design |

## 9. A person's file on a Card, in the Work sandbox (#843)

Read in the pinned image, unmodified:

- The Engine keeps a Card's file under its Kanban attachments folder, `/opt/data/kanban/attachments/<task>/<name>` on the
  default board (`hermes_cli/kanban_db.py`: `attachments_root`, `kanban_home`, `task_attachments_dir`), and its row
  carries that absolute path (`stored_path`). The dashboard's `POST /tasks/{id}/attachments` takes a multipart form,
  `file` and `uploaded_by` (free text, so gtmworks writes the person's name), streams it to disk and answers the row; past
  `KANBAN_ATTACHMENT_MAX_BYTES`, 25 MB, the dashboard's, the tools' and the CLI's one cap, it answers 413 `attachment
  exceeds 25 MB limit` and keeps nothing. `GET /attachments/{id}` serves the file only from under that folder.
- The worker is told each file by that absolute path in its first prompt, under `## Attachments`: "Read them with the
  file/terminal tools at the absolute paths below" (`hermes_cli/kanban_db_context.py`, `_ctx_attachments`). Hermes's own
  word for a remote backend is in the same two places: "Workers read attachments by absolute path, so remote terminal
  backends must mount it" (`attachments_root`), "remote terminal backends need the attachments dir mounted".
- On the `ssh` backend a worker's `read_file` sends the path as given to the remote shell (`tools/file_tools.py`,
  `read_file_tool`: `file_ops.read_file(path)` when the file operations do not use host paths), and its terminal runs
  there, so the file must be at that same path inside the Work sandbox. No read guard names the Kanban folders
  (`agent/file_safety.py`, `get_read_block_error`: credential stores, `mcp-tokens/`, `browser-profile/`, `vault/`,
  `webapp/`, skill caches).
- The Engine writes the file with Python's default mode under the gateway's umask (`open(dest, "wb")`, a folder with
  `mkdir`): no write of the pinned image narrows it, so the file is `0644` and its folder `0755` under the usual `022`,
  readable by the sandbox's user (`pn`, uid 1000) beside the Engine's (`hermes`, uid 10000). The install proof's copy
  below is what shows it on the real Engine; a failed copy prints the folder's modes.

So it needs no change to the Engine, a setting at most in ADR 0022's order, and here not even that: the install mounts
the folder. `scripts/engine-template.yml` gives each Company's sandbox one more volume, the Engine's own data volume with
Docker's `subpath: kanban/attachments`, read-only, at `/opt/data/kanban/attachments`: only that folder of the volume, so
nothing else the Engine keeps there (its keys, its sign-ins, its sessions) reaches the sandbox, and the sandbox writes
nothing the Engine reads (ADR 0018). A mount of a subpath that is not there does not start, and a fresh volume has none,
so the Engine's start makes the folder, `0755` and the Engine's user's, before the gateway, and the sandbox starts once
its Engine is healthy (`depends_on: service_healthy`). It needs Docker Engine 26 and Compose 2.26 or later (the volume
subpath). The template is the one every Engine of an install is made from, so a new Company and one brought up by
`gtmworks update` both have it.

What the install proof's Kanban check adds (`scripts/check-install-profiles.mjs`, `lib/install-kanban.mjs`,
`scripts/ci-install-check.sh`):

| Acceptance criterion of #843 | Where the check holds it |
| --- | --- |
| On the pinned Engine a worker opens a file a person added, from inside the Work sandbox | the step adds `<marker>-brief.txt` to Card A through `POST /tasks/{id}/attachments` under the person's name before the tick; the Engine's answer names it under `/opt/data/kanban/attachments/`; Card A's first command, in the sandbox, copies it from the path its prompt names into `/work/<marker>-attachment.txt`, and the job reads that file from the sandbox through the host's Docker and compares its bytes |
| A write to that folder from the sandbox fails | the same command tries `touch <the file's folder>/<marker>-planted` and prints `refused`; the job finds no such file in the sandbox or on the Engine |
| The mount is present for a new Company and for one `gtmworks update` brought up | `sandbox_card_files` (`scripts/ci-install-lib.sh`) on every Engine of the open-design area, the second Company's included, and after the update in the update and engines-update areas: the sandbox's mount at `/opt/data/kanban/attachments` is its Engine's data volume, read-only, subpath `kanban/attachments`, and a write there as the sandbox's user fails |

The step's time grows by one request and two short commands inside Card A's first one, well under a second; the
open-design area's minutes stay as section 8 gives them.

What gtmworks keeps of it: nothing. A Card's file is listed from `GET /tasks/{id}` (its id, name, type, size, who added
it and when; never `stored_path`), added and read back by gtmworks's own routes (`app/api/board/card/files/route.ts`,
`app/c/[slug]/files/board/[card]/[file]/route.ts`), and a file the Agent made is named by a MEDIA line in its summary or
comment and read from its own work folder in the sandbox through the Engine's file routes (ADR 0028, lib/engine/files.mjs),
as a Conversation's reply is.

A shortcut to note: a volume subpath that is a symbolic link is followed inside the volume by Docker. Nothing in the
sandbox can make one there (the mount is read-only), and on the Engine only the Engine's own processes write under
`/opt/data/kanban`; the file tools write only under `/work` (`HERMES_WRITE_SAFE_ROOT`) and the terminal runs in the
sandbox. A link put there by the Engine itself would show the sandbox more of the volume, read-only.
