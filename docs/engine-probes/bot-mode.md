# How much of Hermes's Bot Mode can gtmworks use with no Desktop? (#969)

**Most of it.** With no Desktop program and no shell in the Engine's container, the Engine's own routes mark a profile
as a Bot, make its one permanent Bot Chat, run people's turns in it one after the other, put a Routine's result in it
by itself, and carry one Agent's message to another and the reply back, all under the install's managed `ssh`
terminal backend. Three things are missing, and gtmworks would have to supply each one: the Engine keeps no person's
name; a Bot Chat turn streams nothing live and cannot be stopped; and nothing wakes an Agent when another Agent's reply
comes back.

| Part | Verdict | Why |
| --- | --- | --- |
| The shared permanent chat, with names | **usable with a named change** | The Engine makes, keeps and queues one Bot Chat per Agent (questions 1, 2, 4). It keeps no person's name (question 3): gtmworks keeps one row per message, the Run's `delivery_id` and the Member. A Bot Chat turn's event stream carries only `run.completed`, so the screen reads the turn from the session, and Stop cancels the Run while the turn still finishes. |
| A Routine's result in the chat | **usable as shipped** | `deliver: bot-chat` in place of `deliver: local` (question 5). The result arrives as a Bot Chat turn within one housekeeping tick (60 s) of the run, and the Agent answers it. `[SILENT]` leaves nothing. A failure notice arrives in the same chat as a `diagnostic` turn. Each result costs one more model turn: the Agent's answer to it. |
| Agent-to-Agent messages | **usable with a named change** | `message_agent` is delivered and answered under the managed backend (question 6), because its delivery runs on the Engine and never in the Work sandbox. The reply is written into the sender's Bot Chat at once, but with no Desktop nothing wakes the sender: gtmworks starts a Run in the sender's Bot Chat when the reply lands. |

Measured on 2026-11-28 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, with the fake model of `engine-stack/`. The Engine runs with the
install's managed configuration mounted where the template mounts it (`scripts/engine-managed.yml`, `engine-managed.env`
and the file-sync hook), and its terminal reaches a Work sandbox of the install's own sandbox image over the `ssh` backend,
as an install's does. The probe speaks only to the Engine's own routes: the Run API, the management listener's REST
routes and its JSON-RPC socket `/api/ws`, plus the fake model's record of what each request carried (its tools, its
system prompt's `## ` headings and roster lines, and its user messages).

Run it again with `sh docs/engine-probes/bot-mode/run.sh` (about two and a half minutes). It stands up the throwaway Engine of
`docs/engine-probes/engine-stack/` (#823) and the sandbox, runs `bot-mode/probe.mjs`, prints the lines in section 5 and
removes everything it made. An answer other than the recorded one exits non-zero. `KEEP=1` leaves the stack up.

# 1. What the Engine answered

Profiles `alpha` and `beta` are marked as Bots; `gamma` is left unmarked.

| Question | What was asked | Answer |
| --- | --- | --- |
| 1. Making a Bot Chat | `POST /api/auth/ws-ticket`, then on `/api/ws` the JSON-RPC `profiles.configure {name, ui_meta: {"hermes-bots": {title}}, description}`; then `POST /p/alpha/api/sessions {title: "Bot Chat"}` on the Run API | **Yes, with no Desktop and no shell.** `profiles.configure` writes `ui_meta`, its revision and the description into the profile's `profile.yaml` (read back by `profiles.list`). The create answers 201 with a `local-…` session (`source cli`, `user_id api-peer`), which `profiles.list` then names as the profile's `canonical_session`. A second create answers 400 `invalid_title`. A create that carries anything but `title` and `source` (a system prompt, say) answers 400 `bot_chat_parameters_unsupported`. No REST route writes `ui_meta`: the socket is the one way. |
| 2. A turn in it | `POST /p/alpha/v1/runs {input, session_id: <Bot Chat>}`; the session read back with `GET /api/sessions/<id>` and `/messages?order=oldest`; the Run's `GET …/events`; `POST …/stop` mid-turn | **Yes, it is a Bot Chat turn.** The Run completes in that session and answers a `delivery_id`: it was admitted to the Bot Chat's own queue. The model is offered `message_agent` and a "Messaging other agents" section listing the roster (`@hermes`, which is the root profile, `@beta — Beta Analyst — …` and `@gamma`). The next turn's request holds the first turn. The title stays `Bot Chat`, and the turns read back on spec #864's session routes; a person's message has `display_kind: internal_notification`, which gtmworks's reader does not hide. An ordinary session of the same profile is offered neither. **The gate covers the whole install:** the unmarked `gamma`'s Bot Chat gets both, because one marked profile is enough. **Two differences from an ordinary Run:** the Run's event stream carries only `run.completed` (an ordinary turn sends `tool.started`, `tool.completed`, `message.delta`, `run.completed`), and Stop answers 200 and ends the Run `cancelled` while the turn finishes in the Bot Chat with its reply. |
| 3. Who is speaking | The Run of question 2 with `author: {id: "member:mona", name: "Mona"}` | **The Engine keeps no person's name.** The model's request does not name Mona, the session's messages and row do not, and the Run's read-back does not. What links a message to its Run: the stored user message's `platform_message_id` is `bot:<delivery_id>`, and the Run answers that `delivery_id`. **The smallest thing gtmworks keeps:** one row per person's message, `(delivery_id, Member)`, written when the Run is started. |
| 4. Several people at once | Two `POST …/v1/runs` into the same Bot Chat at the same moment, Mona's model taking 4 s and Karim's 1 s | **Queued.** Both callers get 202 `started` and a Run of their own. The Bot Chat runs them one after the other, each turn whole (Karim's turn, then Mona's, 4.1 s apart). Each caller reads back its own reply. Nothing is refused or interleaved. |
| 5. A Routine's result | `POST /api/cron/jobs?profile=alpha {…, deliver: "bot-chat"}`, then `POST …/trigger`: twice with a reply, once answering `[SILENT]`, once failing (a `base_url` with no provider, which the Engine refuses before calling the model) | **Yes, by itself.** The result arrives as a user turn `[Cronjob "<name>" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]` followed by the output, and the Agent answers it in the chat. The job's own run session is still listed in `…/runs`, where gtmworks reads a Routine's replies today. **Timing:** the first result came 38–47 s after its run in every run of the probe, the second under a second after its run. `[SILENT]`: nothing in the chat, job `ok`. A failure: job `error`, and its notice `⚠️ Cron '<name>' failed: …` is a turn in the same Bot Chat with `notification_category: diagnostic`. |
| 6. Agent to Agent | In alpha's Bot Chat the model calls `terminal {"command": "hostname; command -v hermes …"}`, then `message_agent {target: "beta", message}`; then a Run started in alpha's chat; then a Run in beta's Bot Chat with `author: {id: "bot:alpha", is_bot: true}` | **Delivered and answered.** The Agent's own terminal runs in the Work sandbox, which has no `hermes`. `message_agent` answers `queued` at once. Beta's Bot Chat, which did not exist, is made and holds `Message from 🤖 Alpha Writer (@alpha): …` with beta's reply. That reply is back in alpha's Bot Chat about 6 s later as a `process_complete` message. The delivery ran on the Engine as `python tools/bot_mode_dm.py --run-delivery … hermes -p beta`, not in the sandbox. **Nothing wakes alpha:** 20 s later its model had been sent nothing more. A Run started then in alpha's chat gives its model the reply, folded into that turn's message. A Run that the caller starts in beta's Bot Chat is a second way, which needs only the Run API. |

# 2. The source behind each answer

All paths are in the pinned image, under `/opt/hermes`.

- **The Bot gate and the section** (`tools/bot_mode_probe.py`). A Bot Chat is the session titled exactly `Bot Chat`
  (`BOT_CHAT_TITLE`, :37). A profile is a Bot when its `profile.yaml` carries `ui_meta['hermes-bots']`
  (`_is_bot_managed`, :131). The gate, `is_bot_mode_managed` (:139), asks whether **any** profile on the install is one,
  which is why the unmarked `gamma` gets the tool. The roster takes the default profile and every live named profile
  (`_roster`, :86); the default answers to `@hermes` (`_handle`, :73). The section is built in `_build_section` (:288).
- **Marking a profile** is the Desktop's Bots editor call, `profiles.configure` (`tui_gateway/methods_profiles.py:386`).
  It merges `ui_meta` key by key under a per-key revision (`_configure_ui_meta`, :605). `profiles.list` reports the
  canonical chat by its title (`_canonical_session_row`, :162). The socket is `/api/ws`
  (`hermes_cli/web_routers/chat_ws.py:650`), opened with a single-use ticket from `POST /api/auth/ws-ticket`.
- **Making the Bot Chat.** `POST /api/sessions` (`gateway/platforms/api_server.py:2574`) first offers the body to
  `create_peer_bot_chat` (`gateway/platforms/api_server_bot_chat.py:34`). That is the create-if-missing of `hermes peer dm`:
  under the gateway's session authority it mints the chat as a LOCAL session that the authority's queue owns, and it
  refuses any field but `title` and `source` (`_PEER_CREATE_FIELDS`, :26). The gateway serves every profile's authority
  (`gateway/session_authorities.py:192`, `authority_for_home`), so this works for a named profile too.
- **A turn in it.** A Run whose session is the Bot Chat is admitted to that chat's queue before anything else happens
  (`gateway/platforms/api_server_runs.py:878`, `_admit_to_live_bot_chat`, `api_server.py:2916`; `admit_peer_turn`,
  `api_server_bot_chat.py:128`). Its status is then driven only by the queue's receipt
  (`_execute_run_via_live_owner`, `api_server_runs.py:1011`), which publishes `run.<status>` and nothing else: hence the
  lone `run.completed` event. The docstring says it directly: "`/stop` cannot reach the owner's turn … a stop ends this
  run as `cancelled` while the chat finishes on its own". The tool is added only in a Bot Chat on a Bot install
  (`message_agent_authorized`, `tools/bot_mode_dm.py:127`; `ensure_message_agent_tool`, :144).
- **The author** "only labels memory" (`_request_turn_author`, `api_server.py:583`). It is parsed onto the turn
  (`agent/turn_context.py:1116`) and reaches only memory providers that accept it (`agent/memory_manager.py:444`). The
  visible `Message from 🤖 <name> (@handle):` prefix is text that `message_agent` writes into the message (`bot_mode_dm.py:288`),
  not something the Engine adds for a person.
- **Several at once.** One authority queue per Bot Chat admits each turn in order (`api_server_bot_chat.py:1-10`, the
  module's account: "a LOCAL session whose only writer is the authority FIFO").
- **A Routine's result.** `deliver: bot-chat[:<profile>]` is parsed by `parse_bot_chat_deliver_token`
  (`cron/scheduler_delivery.py:818`) and sent by `_deliver_to_bot_chat` (:714) as "a real inbound Bot Chat turn", with
  the text of `bot_chat_message` (:697). A failure takes the same lane, with `notification_category: diagnostic` (:775),
  and is not filtered the way other platforms' warnings are (:1890). `[SILENT]` skips delivery
  (`cron/scheduler.py:3105`). The delay: a cron worker queues its send (`cron/scheduler.py:3124–3137`), and the gateway
  drains that queue on its 60 s housekeeping tick, or as soon as its watch sees the queue file change
  (`gateway/run_delivery_queue_watch.py:64`). The watch picks up the profiles it watches once per tick (:37), so a
  profile's first result can wait up to a tick and later ones arrive in under a second.
- **Agent to Agent.** A local teammate is reached by starting a background delivery runner
  (`_dispatch`, `bot_mode_dm.py:296`; "Local teammates are admitted through the profile authority; the argv only names
  the profile … and is never executed", :361) through `terminal_tool(…, _host_local=True)` (:846). For `_host_local` the
  terminal uses the `local` backend, whatever the configured one is (`tools/terminal_tool.py:1196`). So the managed
  `ssh` pin does not apply, and the sandbox needs no Hermes: the issue's reading, that the delivery would run in the
  Company's Work sandbox, does not hold. The runner's completion is admitted into the sender's session as a process
  notice (`gateway/session_automation.py:85`, `admit_process_notice`). The probe found that no model turn ran for it;
  the next turn that is admitted carries it.

# 3. Group chats (not probed again)

Vault decision 0058 measured Hermes's group chats on 2026-11-20. Its findings, as recorded in #969, `ROADMAP.md`
("Hermes Group Chat under channels … hard caps clash with decision 0057") and ADR 0033 ("a room holds one human
actor"):

- rooms run headless on `/api/ws`;
- a room holds one human actor;
- a discussion holds at most 6 members (`MAX_DISCUSSION_MEMBERS = 6`, `gateway/hosted_room_discussion.py:29`) and takes
  a fixed number of continues (`MAX_DISCUSSION_CONTINUES = 5`, `gateway/hosted_room_router.py:29`).

# 4. What this means for the tickets

- **#927 (Good morning is an ordinary Routine).** Good morning would need no machinery of gtmworks's own: the main
  Agent's Routine with `deliver: bot-chat` puts its result in the main Agent's Bot Chat by itself. The ticket's "the
  Routine's row opens its last result" still reads `…/runs` as it does today, because the run session stays. One
  difference to weigh: each delivered result costs the Agent one more turn, its answer to the result.
- **#928 (the Handover is gone).** `message_agent` does what the Handover did, an Agent asking another and getting the
  answer, with Hermes's own tool and under the install's backend. gtmworks would add one thing: a Run in the sender's
  Bot Chat when the reply lands, so that the Agent acts on it. A Card on the board, which the ticket names instead, stays
  the way for work that needs a record.
- **Channels (#921).** The shared permanent chat is what Bot Mode offers in their place. The Engine queues people's turns
  and keeps the chat. gtmworks keeps who said each one (`delivery_id`, Member), reads the turn from the session instead
  of the Run's stream, and cannot stop a turn once it has started.

# 5. The run

```
engine nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
managed configuration mounted: terminal backend ssh to the Work sandbox (36cf16da1505)
question 1: /api/ws profiles.list answers bot_mode_protocol true; alpha's canonical_session null
question 1: profiles.configure wrote alpha's profile.yaml: ui_meta {"hermes-bots":{"title":"Alpha Writer"}}, revisions {"hermes-bots":1}
question 1: POST /p/alpha/api/sessions {title:"Bot Chat"} answered 201: id local-2e426a03df69ae2ae2502c803c1c31264fe2f2ce3d21a3f40e6b6d2f2778914f, source cli, user_id api-peer; a second create 400 invalid_title; a create with a system prompt 400 bot_chat_parameters_unsupported; profiles.list now names canonical_session local-2e426a03df69ae2ae2502c803c1c31264fe2f2ce3d21a3f40e6b6d2f2778914f
YES question 1: a profile is marked with /api/ws profiles.configure (ui_meta in its profile.yaml) and its one Bot Chat is made with POST /api/sessions on the Run API, both on the Engine's own routes
question 2: a Run with session_id local-2e426a03df69ae2ae2502c803c1c31264fe2f2ce3d21a3f40e6b6d2f2778914f ended completed (session local-2e426a03df69ae2ae2502c803c1c31264fe2f2ce3d21a3f40e6b6d2f2778914f, delivery_id 0cebbbec6f0d4152a681fc5c090faa84), output "hello back a3512ef1"
question 2: the model was offered message_agent: true; its prompt's sections: ## Mid-turn user steering | ## Messaging other agents | ## Skills; its roster: - `@hermes` - `@beta` — Beta Analyst — Beta Analyst: the probe's beta - `@gamma`
question 2: the next turn's request held the first turn (history): true; the session's title is still "Bot Chat", 4 messages read back on GET /api/sessions/<id>/messages: user(internal_notification), assistant, user(internal_notification), assistant
question 2: an ordinary session of the same profile: message_agent offered false, sections ## Mid-turn user steering | ## Skills
question 2: the unmarked profile gamma's Bot Chat: message_agent offered true, "Messaging other agents" true
question 2: the Run's event stream: a Bot Chat turn sent ["run.completed"]; an ordinary turn sent 4 events (tool.started, tool.completed, message.delta, run.completed)
question 2: Stop mid-turn on a Bot Chat Run: the stop route answered 200, the Run read stopping and then ended cancelled, and the turn still finished in the Bot Chat (its reply is there)
YES question 2: a Run in the Bot Chat is a Bot Chat turn: title and history kept, the section and message_agent offered, read back on the session routes; but its event stream carries only run.completed
question 3: author {name:"Mona"} on the Run: the model's request names Mona false; the session's messages and row name Mona false; the Run's read-back names Mona false
question 3: the stored user message carries platform_message_id bot:0cebbbec6f0d4152a681fc5c090faa84 and message_uid 8de226824d074105ac0fc65984a97db3; the Run answered delivery_id 0cebbbec6f0d4152a681fc5c090faa84
YES question 3: the Engine keeps no person's name: the model is not told it, the session does not store it and no read gives it back; the Run's delivery_id is the stored message's platform_message_id "bot:<delivery_id>", so gtmworks keeps one row per message (delivery_id, Member)
question 4: two Runs started at once in alpha's Bot Chat: Mona's answered 202 started, Karim's 202 started
question 4: Mona's ended completed "to Mona d1cdf724", Karim's completed "to Karim d1e4550a"; Karim's ended first, the other 4.1 s later (its model took 4 s); all done 5.4 s after the start
question 4: the Bot Chat holds them in this order: user:From Karim d1e4550a. / assistant:to Karim d1e4550a / user:From Mona d1cdf724. / assistant:to Mona d1cdf724
YES question 4: queued: both callers get 202 and a Run of their own; the Bot Chat runs them one after the other, each turn whole, and each caller reads back its own reply
question 5: a Routine with deliver "bot-chat", run now: its result is in the Bot Chat as a user message (display_kind internal_notification, platform_message_id bot:6391d069ab30…): "[Cronjob \"brief-b26d180c\" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\nToday: three leads came in b26d180c."
question 5: timings: the first result 40.1 s after the trigger, 38.7 s after its run was recorded; the second 0.9 s after the trigger, 0.4 s after its run
question 5: the Agent answered it in the Bot Chat: "fake reply"; the job: last_status ok, last_delivery_queued {"bot-chat:(own)":{"status":"queued","delivery_id":"6391d069ab30fe8340b7d484d10db1880dd80d75b070dccf3032913f11e6868e"}}; its own run session is still listed (cron local-67436b3f4b…)
question 5: a Routine that answers [SILENT]: last_status ok, 0 new messages in the Bot Chat 15 s after its run
question 5: a Routine that fails: last_status error; its notice is in the Bot Chat as a user message, display_metadata {"gateway_input_owner":"9265b72c-9b33-5713-9695-1fd6c19dd670","notification_category":"diagnostic"}: "[Cronjob \"broken-dbf3451d\" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\n⚠️ Cron 'broken-dbf3451d' failed: Cron job '15c21a6083a4' blocked for safety: b"
YES question 5: the result arrives by itself as a Bot Chat turn within one housekeeping tick (60 s) of the run and the Agent answers it; [SILENT] leaves nothing; a failure notice arrives in the same Bot Chat as a diagnostic turn
question 6: the Agent's terminal in its Bot Chat answered "{\"output\": \"36cf16da1505\\nno-hermes-here\", \"exit_code\": 0, \"error\": null, \"cwd\": \"/home/pn\"}" (the Work sandbox is 36cf16da1505)
question 6: alpha's turn ended completed; message_agent answered {"status": "queued", "delivery_id": "4f8ac60de0629d1d8a0b70772fbe2ac399c274d2d100917c3c5a724c201bf864", "to": "@beta", "detail": "Durably queued for the live Bot Chat owner. Do NOT wait or resend; finish your turn.", "process_id": "proc_cd0
question 6: beta had no Bot Chat before (true); beta's Bot Chat local-9fa283a18e789ed36334ddefbd0dcd0575ea6c2db12c4f192835f096ca766f9d now holds "Message from 🤖 Alpha Writer (@alpha): Send me the lead count ddccf904." and its reply "beta says 42 leads ddccf904"
question 6: the reply came back into alpha's Bot Chat 5.7 s after the turn started, as a process_complete message; the delivery ran on the Engine as: /opt/hermes/.venv/bin/python /opt/hermes/tools/bot_mode_dm.py --run-delivery --author '{"id":"bot:alpha","name":"alpha","is_bot":true}' query-file <dm file> --profile-home /opt/data/profiles/beta /opt/hermes/.venv/bin/hermes -p beta
question 6: 20 s later alpha had been woken to act on it: false (alpha's answers since the hand-off: 2, its own "asked beta" only); a Run started then in alpha's Bot Chat ended completed, and its model got the reply folded into that turn's message: true
question 6: a Run started by the caller in beta's Bot Chat, author bot:alpha: completed "beta answers by the Run API f0fb311b"
YES question 6: delivered and answered under the managed backend: the delivery is a Hermes process on the Engine itself, not the Agent's terminal, so the sandbox needs no Hermes; a Run in the other Bot Chat is a second way that needs only the Run API

VERDICT shared permanent chat with names: usable with a named change — the Engine makes, keeps and queues one Bot Chat per Agent with no Desktop, but keeps no person's name (gtmworks keeps delivery_id → Member per message), streams nothing live for a Bot Chat turn (only run.completed: the screen reads the turn from the session) and cannot stop one (Stop cancels the Run, the turn finishes)
VERDICT a Routine's result in the chat: usable as shipped — deliver "bot-chat" instead of "local": the result arrives by itself within a minute of the run, [SILENT] leaves nothing, a failure notice arrives as a diagnostic turn; each result costs one more model turn, the Agent's answer to it
VERDICT Agent-to-Agent messages: usable with a named change — message_agent is delivered and answered under the install's managed ssh backend (its delivery runs on the Engine, never in the Work sandbox), and the reply is written into the sender's Bot Chat at once, but with no Desktop nothing wakes the sender: gtmworks starts a Run in the sender's Bot Chat when the reply lands
```
