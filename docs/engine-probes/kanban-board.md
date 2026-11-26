# What the Engine's own Kanban board does for gtmworks (#833, spec #831)

Measured on 2026-11-26 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, with a fake OpenAI-style model whose answers a script chose.
This first pass ran the Engine alone, with its terminal on its own disk (`local` backend), to learn the board's
routes and its lifecycle; the Work-sandbox steps (the `ssh` backend, the start folder, the files) are proven by the
install proof's Kanban check (`scripts/ci-install-check.sh`, agents-sandbox area), and its results are added below.

Sources read in the image: `plugins/kanban/dashboard/plugin_api.py` (the routes), `hermes_cli/kanban_db*.py` (states,
review reopen), `hermes_cli/kanban_db_dispatch.py` (the worker's spawn), `tools/kanban_tools*.py` (the Agent's tools
and when they are offered), `model_tools.py` and `hermes_cli/tools_config.py` (toolset selection),
`tools/approval_detection.py` (what is dangerous).

## 1. The routes, on the management listener

All under `/api/plugins/kanban`, behind `Authorization: Bearer <the Engine's key>` (the dashboard session token the
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
