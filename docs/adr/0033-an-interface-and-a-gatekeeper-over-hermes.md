---
status: accepted
date: 2026-11-26
---

# gtmworks is an interface and a gatekeeper over Hermes

Omar's decision of 2026-11-26 (vault decision 0074, a grill of thirteen questions). It carries [ADR 0017](0017-hermes-keeps-skills-knowledge-rules-steps-and-usage.md) and [ADR 0022](0022-hermes-first-then-the-smallest-change.md) to their end. It supersedes:

- [ADR 0026](0026-one-board-in-gtmworks-working-the-hermes-kanban-way.md);
- the engine contract of [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md), kept by [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md), and its tools offered in a Run's instructions;
- ADR 0017 where it keeps a Conversation's record in gtmworks, and [ADR 0029](0029-a-message-is-stored-before-its-run-starts.md), which stores a person's message there first;
- [ADR 0031](0031-one-way-to-the-engine-and-one-run-lifecycle.md) where it covers Conversations, Channels, Handovers and Good morning.

Not built yet. The code, `GLOSSARY.md` and the tests describe today's product until each spec lands; a spec changes the glossary terms it touches in its own pull request.

## Context

- Omar asked for one thing: his own interface over every feature, power and setting Hermes has, and nothing new built beside it. The aim is marketing run by Agents end to end. The team is the fuel: it teaches the Agents and makes them do and reach more.
- ADR 0017 already said gtmworks is Hermes plus the team layer and the UI. The product grew the other way after it: about 89 tables and 545 database functions (counted in the migrations on 2026-11-26), a Conversation's record kept in gtmworks and again in the Engine, and a Run lifecycle written four times (ADR 0031).
- Omar's install on 2026-11-26: one Member, 36 Conversation messages in seven days, no Channel message ever.
- Read in the pinned Engine (Hermes v0.23.0):
  - Its dashboard signs in one owner: one shared credential, no per-person accounts and no Roles. No route checks who the caller is (`hermes_cli/dashboard_auth/`, `hermes_cli/web_server.py`).
  - A session stores no author for a message and cannot be marked as one person's (`hermes_state_common.py`, `gateway/platforms/api_server.py`).
  - Its Kanban board holds tasks, comments, links, attachments, a review status and an event stream. It has no date and no identity on a write (`hermes_cli/kanban_db.py`, `plugins/kanban/dashboard/plugin_api.py`).
  - Its dashboard takes themes and plugins, and runs behind a reverse proxy at a sub-path (`hermes_cli/dashboard_auth/prefix.py`).
  - A plugin registers a tool the Agent calls natively, and its handler receives the session id (`hermes_cli/plugins.py`, `model_tools.py`).

## Decision

**The rule.** What Agents do and keep lives in the Engine, and gtmworks shows it. gtmworks stores only what is about people: who they are, their Role, and what they may see. The gatekeeper is the part of gtmworks that stands before each Company's Engine: sign-in, membership, Role, and the log of who did what.

1. **A Conversation's messages are kept in the Engine only.** gtmworks keeps one row for each Conversation: whose it is. Condition: Probe A of spec #822 passes. The last 50 messages of a 2 000-message session come back from a busy Engine in under 0.5 s at p95; between 0.5 s and 1 s the question goes to Omar; over 1 s it fails and this item goes back to him with the number.
2. **The board is the Engine's Kanban board.** gtmworks adds two things: a Member as a Card's Assignee, and the publishing date.
   - The statuses are the Engine's eight. How they are grouped on the screen is Omar's to draw. There is no Live column: published is done, with the publishing date on the Card.
   - A review works as Hermes does it: an Agent or a person passes the work or sends it back, and the Card shows who. The Engine records no identity on a write, so when a person reviews, gtmworks writes their name on the Engine's record. The line "an Agent never approves" ends; "Approval" and "Version" leave the product's words and the review stays.
   - A board worker's dangerous command runs (`approvals.single_query_mode: approve`), as [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md) asks. It runs in the Company's Work sandbox, which holds no key.
3. **Channels get no new work.** What is built stays. Their fate is decided when a team uses them.
4. **The Owner opens the Engine's own dashboard** behind gtmworks's sign-in, in gtmworks's colours, for every Hermes page gtmworks does not show: messaging platforms, plugins, webhooks, logs, system. gtmworks draws its own screen only for what a team uses daily.
5. **Owner, Manager, Contributor and Viewer keep fixed meanings.** Changing a Role's permissions for a Company, the separate Grants, and hiding an Agent from a Member go.
6. **These go, each with the Engine's own way in its place:**
   - a Handover: an Agent makes a Card for another Agent;
   - Good morning: an ordinary Routine;
   - the rule record and the approval of a lesson: the Agent's own memory, and the Company wiki for what the whole team shares (vault decision 0061);
   - Agent requests, requests to open an Agent and change proposals: a Manager or a Contributor tells an Owner.
7. **The main Agent (Lead) still makes an Agent when asked in a Conversation**, for an Owner only, through a tool an Engine plugin registers.
8. **These stay in gtmworks:** Roles and invite links, the Activity log, "Waiting on you", and an Agent's Look.
9. **The move starts clean.** A full backup is kept and no migration is built for the old Conversations and Cards. Nothing is deleted until Omar says so.

Technical calls of the grill, put to Omar in its closing summary and confirmed with it:

- The engine contract ends. gtmworks talks to Hermes directly, through the one transport and the handle of ADR 0031.
- Any other tool gtmworks gives an Agent is registered by an Engine plugin too. None is described in a Run's instructions and read back out of the reply.
- A Member's own note stays in gtmworks: it is about the person.
- A Conversation's and a Card's files follow the Engine.
- The database stays and its tables shrink as the specs land. Replacing it is looked at after the removals, with numbers.

## Considered options

- **A theme and plugins on Hermes's own dashboard, and nothing else.** Rejected: that dashboard is built for one owner, so a team has no accounts and no Roles on it, and anyone who signs in reads every key.
- **Keep today's shape and finish ADR 0031.** Rejected: it tidies the second record and the second board and keeps both.
- **Hermes's group chat under Channels.** Rejected earlier (vault decision 0058): a room holds one human actor.

## Consequences

- gtmworks is tied closer to the pinned Engine: its screens read the Engine's own routes. A pin bump is proven against every screen before it is released.
- Deleting an Agent deletes its Conversations, and an Agent moved to another profile does not take its history.
- Work can be published with no person having seen it, when a Member asked for it and the reviewing Agent passed it.
- Any Contributor may talk to any Agent of the Company, one that can spend included. A limit comes back after a real problem (ADR 0020).
- A Card's files are on the Engine's disk, not in the Company's storage.
- Paused on 2026-11-26, nothing closed: specs #668 (with draft pull request #748) and #669 with their tickets; tickets #785 to #788 and #790 of spec #761; pull request #814 with its ticket #470, which extends the Handover; ticket #649, which is Channel work. The rest of #761 carries on.
- Order: the three probes of spec #822 first (the speed of item 1, the dashboard behind the sign-in, a plugin tool that knows its person), then the board, the Conversation, the Owner's dashboard, and the removals one by one. Each removal is staged ([ADR 0023](0023-a-change-the-previous-release-cannot-run-against-is-staged.md)).
