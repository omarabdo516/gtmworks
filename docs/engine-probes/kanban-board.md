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
  unknown`); every Agent profile gtmworks makes keeps the bundled Skills, and the install check proves review on one.

## 7. The settings the install writes

| Setting | Where | Why |
| --- | --- | --- |
| `approvals.single_query_mode: approve` | `scripts/engine-managed.yml`, mounted read-only at the managed scope (`/etc/hermes/config.yaml`) of every Company's Engine, the first one's, one `gtmworks company add` makes and one `gtmworks update` brings up | a worker's Run is single-query (`gateway/session_kanban.py`) and refuses a dangerous command by default (section 3). The managed scope is applied per leaf after a profile's own config, so a profile's `approvals.unattended_mode` stays its own and a profile's write of `single_query_mode: deny` changes nothing |
| `kanban` offered, never disabled | every profile's `platform_toolsets.api_server`, written by the worker (`lib/agent-toolsets.mjs`, `everyAgentGets`), no longer in `noAgentGets` | the Kanban tools are offered to Runs started through the Run API, and a board worker keeps its lifecycle tools (section 4). It cannot be a managed setting, which would replace each Agent's whole list. A child Run never gets it: the Engine keeps `kanban` from sub-agents (`childToolsets`) |
| `kanban.dispatch_in_gateway`, `kanban.review_dispatch`, `kanban.dispatch_interval_seconds` | not written | the dispatcher and the review dispatch stay on, every 60 s, as Hermes ships them |

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
models. Its results are added here from the first green run.
