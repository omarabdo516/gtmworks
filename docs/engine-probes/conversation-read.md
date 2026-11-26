# How fast does the pinned Engine give back the end of a long Conversation on a busy server? (#824, #825)

**Pass.** The last 50 messages of a 2 000-message session came back in 19 ms at p95 with the Engine busy (the line is
0.5 s). Measured on 2026-11-26 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, through the Engine's own HTTP routes only.

Run it again with `sh docs/engine-probes/conversation-read/run.sh` (about 25 minutes, most of it the seed; it loads every
core of the host for a few minutes). It stands up the throwaway Engine of `docs/engine-probes/engine-stack/` (#823),
runs `conversation-read/probe.mjs`, prints the table and the answers below, and removes everything it made. A read that
fails or returns another count than asked, and an answer other than the one below, exits non-zero with the Engine's
answer. `KEEP=1` leaves the seeded stack up for another try (`stack.sh exec conversation-read node …`, then
`stack.sh down conversation-read`).

# 1. How it was measured

- **The host**: 4 cores, 15 GB, the cloud VM of this session; the Engine and its fake model are the only containers of
  the stack. It is not Omar's server: his install read a load average of 7.4 to 8.6 on 2026-11-26, and his Engine held
  no session then, so it could not answer.
- **The seed**, every message made by a Run against the fake model (`engine-stack/fake-model.mjs`), never imported: one
  turn is the person's message, the Agent's tool call (`skills_list`), the tool's answer and the Agent's reply, in the
  shape a Run stores. Profile `conv` holds sessions of 53, 501 and 2 001 messages (`conv-50`, `conv-500`, `conv-2000`;
  the extra one is the Engine's `session_meta` row). Profiles `list-10`, `list-100` and `list-1000` hold that many
  sessions of one turn each. The seed took 861 s: the Engine's gateway is one Python process, and it took about two
  Runs a second.
- **One stored message of each kind**, as the messages route gives it back (long values cut):

  | Kind | What the Engine stored |
  | --- | --- |
  | the person's message | `role: user`, `content`, `platform_message_id`, `display_kind: internal_notification`, `display_metadata: {gateway_input_owner, submission_id: <run id>}`, `message_uid` |
  | the Agent's tool call | `role: assistant`, `tool_calls: [{id, call_id, response_item_id, type: function, function: {name: skills_list, arguments}}]`, `finish_reason: tool_calls`, `tool_call_uids` |
  | the tool's answer | `role: tool`, `content: {"success": true, "skills": [], …}`, `tool_call_id`, `tool_name: skills_list`, `tool_call_uid` |
  | the Agent's reply | `role: assistant`, `content: "Reply 0."`, `finish_reason: stop` |

  These are the rows a real Run stores, because every one of them was stored by a real Run; the probe opens no Hermes
  file or database.
- **The reads**: `GET /api/sessions/<id>/messages?profile=conv&order=latest&limit=50` for the last 50, and the same with
  `offset=50` for the 50 before them, on the management listener with the Engine's key, as `lib/hermes.mjs` reaches it.
  The two pages of `conv-2000` join with no gap (rows 2456–2505, then 2506–2555). The list is
  `GET /api/sessions?profile=<p>&order=recent&limit=50`. 200 reads of each, timed from the host.
- **The Run's stream**: 200 Runs, each started with `POST /p/timed/v1/runs` in a session the probe chose; the time from
  that call to the first `data:` event of `GET …/v1/runs/<id>/events` (it was `message.delta`), and from the
  `run.completed` event to the reply being the newest assistant message of the session.
- **Busy**: eight Runs held open on the same Engine against the slow fake model (`DELAY 3600`), all eight still
  `running` at the end, and one busy loop per core in a container beside it. The 1-minute load average was 4.04 when the
  busy reads began and 5.03 when they ended, on 4 cores.

# 2. What the Engine answered

| Read | Quiet p50 | Quiet p95 | Busy p50 | Busy p95 |
| --- | --- | --- | --- | --- |
| conv-50 last 50 | 10 ms | 12 ms | 8 ms | 15 ms |
| conv-50 50 before (none: the session has 53) | 7 ms | 9 ms | 6 ms | 12 ms |
| conv-500 last 50 | 9 ms | 13 ms | 10 ms | 16 ms |
| conv-500 50 before | 10 ms | 13 ms | 11 ms | 17 ms |
| **conv-2000 last 50** | 10 ms | 12 ms | 10 ms | **19 ms** |
| conv-2000 50 before | 9 ms | 11 ms | 11 ms | 19 ms |
| the list of list-10 (title, last activity) | 9 ms | 13 ms | 10 ms | 16 ms |
| the list of list-100, first 50 | 14 ms | 20 ms | 16 ms | 25 ms |
| the list of list-1000, first 50 | 20 ms | 26 ms | 18 ms | 30 ms |
| start a Run to its first event (`message.delta`) | 106 ms | 138 ms | 111 ms | 150 ms |
| final event to the reply readable in the session | 9 ms | 11 ms | 10 ms | 17 ms |

The pass line is the bold row: 19 ms against 500 ms. The reads stay flat from 50 to 2 001 messages because the route
pages in SQL on the newest rows (`hermes_state_messages.py`, `get_messages`, `ORDER BY id DESC LIMIT ? OFFSET ?`). What the
numbers do not cover: the seed's messages are short, so a page of 50 with long tool answers carries more bytes; and
eight held Runs wait on the model without using the Engine's CPU, while a busy Engine on Omar's server also runs tools.

# 3. Three answers about a session

| Question | Answer | What the Engine said |
| --- | --- | --- |
| A caller chooses a session's id before its first Run, and the session then takes a Run through the Run API | **Yes** | before the Run, `GET /api/sessions/gtmworks-<uuid>` answered 404 `{"detail":"Session not found"}`; `POST /v1/runs` with `session_id: gtmworks-<uuid>` answered 202 `{"run_id": …, "status": "started"}`; the Run ended `completed` with that `session_id`, and the session row has that id, `source: api_server`, 3 messages |
| A compacted session returns its older messages when asked | **Yes, with `include_compacted=true`** | the Engine compacts in place (same session id). The plain read answered 38 messages starting at the summary, `user` "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were com…"; with `include_compacted=true` it answered 42, the first "Long message 0…", 4 of them `compacted: 1`. (The profile compacts at 20 000 tokens, `compression.threshold_tokens`, so ten long turns cross it.) |
| A second message to a working session is queued and runs after the first | **Yes** | 202, and it read `queued` while the first ran; the first ended `completed`, then the second; their replies are stored in that order |
| …and the 33rd waiting message is refused | **Yes, but the Engine's cap of ten Runs at once refuses first** | with the install's settings the 11th Run at once, counting the queued ones, is refused: 429 `{"message": "Too many concurrent runs (max 10)", "code": "rate_limit_exceeded"}` with `Retry-After: 1` (`gateway/platforms/api_server.py`, `_concurrency_limited_response`; `gateway.api_server.max_concurrent_runs`, default 10, one count per Engine). With that cap off (`0`), 32 messages waited (`queued`) and the 33rd was refused: 409 `{"message": "queue_full", "code": "queue_full"}` (`gateway/run.py`, `_BUSY_QUEUE_MAX_PENDING = 32`) |

**The list.** The one read that gives titles and last activity for a profile's sessions is `GET /api/sessions?profile=<p>&order=recent&limit=<n>`
(`hermes_cli/web_routers/sessions.py`, `get_sessions`): each row has `id`, `title`, `last_activity_at`,
`message_count`, `preview` and more, `limit` at most 100, with `offset` paging and a `total`. It cannot be narrowed to the
ids gtmworks holds: its filters are `source`, `sources`, `exclude_sources`, `cwd_prefix`, `min_messages` and `archived`,
and `ids=`/`id=` are ignored (with both on two ids the answer was still `total: 100`, 50 rows). One session by id is
`GET /api/sessions/<id>`, one call each. On the first page 43 to 48 rows of 50 had a title: the Engine titles a session
with a side call to the model after its first turn, and a few stayed untitled (`title: null`).

# 4. What this means for the Conversation spec

- **Item 1 of ADR 0033 holds on this number.** Read the last 50 messages from the Engine at the time a Conversation
  opens: `order=latest&limit=50`, and the 50 before with `offset=50` on scroll back. Twenty milliseconds leaves almost
  all of ADR 0030's one second to gtmworks.
- **Choose the session id first.** gtmworks makes the id (a uuid), writes its one row saying whose Conversation it is,
  then starts the first Run with `session_id` set to it. No Run is needed to learn an id.
- **Ask for compacted messages.** A long Conversation gets compacted; every read a person scrolls through passes
  `include_compacted=true`, or the person sees the Engine's summary in place of their older words. Check the summary
  row (`[CONTEXT COMPACTION — REFERENCE ONLY]`) is shown as the Engine's, not as the person's message.
- **The list is one call per profile, not per Conversation**, `order=recent`, paged by 50; it lists every session of the
  Agent's profile, so gtmworks keeps the ones its rows name and drops the rest, and draws an untitled session by its
  `preview`. A person's list across several Agents is one call per Agent.
- **A second message waits its turn**: send it as a Run on the same session; the Engine queues it. Plan for the cap of
  ten Runs at once per Engine (the whole Company): an eleventh gets 429 with `Retry-After: 1`, and gtmworks must keep the
  message and retry, or say so. Raising `gateway.api_server.max_concurrent_runs` is a setting of the Engine's config the
  spec names if it wants more; the per-session queue stops at 32.
- **Stream the Run itself**: the first event came 110 to 150 ms after the Run started, and the reply is readable in the
  session within 20 ms of `run.completed`, so gtmworks keeps no copy of a reply to show it.
- **Re-run this probe at each Engine pin bump** (`run.sh`); its last line says pass or fail.

# 5. The run

```
engine image: nousresearch/hermes-agent:v0.23.0 (nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002)
run api: http://172.29.83.10:8642/health 200
management: http://172.29.83.10:9119/api/profiles 200
env file: /tmp/gtmworks-engine-stack/conversation-read.env
engine nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
date 2026-11-26, host 4 cores
seeded by Runs against the fake model in 861 s: conv-50 holds 53 messages (53 on its session row), conv-500 holds 501 messages (501 on its session row), conv-2000 holds 2001 messages (2001 on its session row); list-10 holds 10 sessions, list-100 holds 100 sessions, list-1000 holds 1000 sessions
stored user: {"id":1,"session_id":"conv-2000","role":"user","content":"Message 0 of this Conversation.\nCALL skills_list {\"category\":\"none\"}\nREPLY Reply…","timestamp":1795654637.595599,"platform_message_id":"f17c1dc7eca44433a07c8903ed42ac1f","active":1,"display_kind":"internal_notification","display_metadata":{"gateway_input_owner":"f3e8f63f-f551-5d47-b984-7fa935003fc0","submission_id":"run_92766fb2dab34d868231e0176826bfdf"},"message_uid":"30bbc814d32d4ed18c0665789b2ad3d3"}
stored assistant: {"id":5,"session_id":"conv-2000","role":"assistant","tool_calls":[{"id":"call_0_skills_list","call_id":"call_0_skills_list","response_item_id":"fc_0_skills_list","type":"function","function":{"name":"skills_list","arguments":"{\"category\":\"none\"}"}}],"timestamp":1795654643.5397973,"finish_reason":"tool_calls","active":1,"message_uid":"347254f39e644eb5b3e38920b1e10e7e","tool_call_uids":"{\"call_0_skills_list\": \"1efc6b637e8a4ec0b34fef0360d80ac3\"}"}
stored assistant: {"id":10,"session_id":"conv-2000","role":"assistant","content":"Reply 0.","timestamp":1795654644.6279285,"finish_reason":"stop","active":1,"message_uid":"e4666188fc83478892e22c49a9536c8c"}
stored tool: {"id":7,"session_id":"conv-2000","role":"tool","content":"{\"success\": true, \"skills\": [], \"categories\": [], \"count\": 0, \"hint\": \"Use skill…","tool_call_id":"call_0_skills_list","tool_name":"skills_list","timestamp":1795654644.433284,"active":1,"message_uid":"10d92782c0b94789825b5eb71a823440","tool_call_uid":"1efc6b637e8a4ec0b34fef0360d80ac3"}
pages of conv-2000: the last 50 are rows 2506-2555, the 50 before are 2456-2505
measured quiet; rows of the first list page with a title: list-10 8, list-100 48, list-1000 43
measured busy; rows of the first list page with a title: list-10 8, list-100 48, list-1000 43
busy: 8 of 8 held Runs still running at the end (running, running, running, running, running, running, running, running); load average 4.04 when the busy reads began, 5.03 when they ended, on 4 cores

| Read | Quiet p50 | Quiet p95 | Busy p50 | Busy p95 |
| --- | --- | --- | --- | --- |
| conv-50 last 50 | 10 ms | 12 ms | 8 ms | 15 ms |
| conv-50 50 before | 7 ms | 9 ms | 6 ms | 12 ms |
| conv-500 last 50 | 9 ms | 13 ms | 10 ms | 16 ms |
| conv-500 50 before | 10 ms | 13 ms | 11 ms | 17 ms |
| conv-2000 last 50 | 10 ms | 12 ms | 10 ms | 19 ms |
| conv-2000 50 before | 9 ms | 11 ms | 11 ms | 19 ms |
| list-10 list | 9 ms | 13 ms | 10 ms | 16 ms |
| list-100 list | 14 ms | 20 ms | 16 ms | 25 ms |
| list-1000 list | 20 ms | 26 ms | 18 ms | 30 ms |
| start a Run to its first event (message.delta) | 106 ms | 138 ms | 111 ms | 150 ms |
| final event to the reply readable in the session | 9 ms | 11 ms | 10 ms | 17 ms |
pass line: the last 50 of conv-2000, busy, p95 19 ms: PASS
the list narrowed to two ids (ids=, id=): total 100, 50 rows returned, so the parameters are ignored; one session read by id: GET /api/sessions/<id> answers its title and last_activity_at

answer 1, a caller chooses the session id: before its first Run GET /api/sessions/<id> answered 404 {"detail":"Session not found"}; POST /v1/runs with session_id answered {"run_id":"run_75f4acbca3ec401a8e56f50370d45d40","status":"started","replayed":false}; the Run ended completed with session_id gtmworks-55602c04-0a0f-4774-a7ec-255e2b972614; the session row has id gtmworks-55602c04-0a0f-4774-a7ec-255e2b972614, source api_server, 3 messages
answer 2, a compacted session: GET …/messages answered 38 messages, the first user "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were com…"; with include_compacted=true 42 messages, 4 of them compacted: 1, the first user "Long message 0. words words words words …"; session id the same (compacted)
answer 3, default cap: the second message answered {"run_id":"run_03fa4b5430924e70950bf892a3147a6a","status":"started","replayed":false} and read queued while the first ran; the first ended completed, the second completed; replies stored in order ["first answer","second answer"]; of 40 more messages, number 11 counting the first two was refused: 429 {"error": {"message": "Too many concurrent runs (max 10)", "type": "rate_limit_error", "param": null, "code": "rate_limit_exceeded"}}
answer 3, cap off: of 40 messages to a working session 32 were taken (32 queued); the first refused was waiting message 33: 409 {"error": {"message": "queue_full", "type": "invalid_request_error", "param": null, "code": "queue_full"}}
probe complete
```
