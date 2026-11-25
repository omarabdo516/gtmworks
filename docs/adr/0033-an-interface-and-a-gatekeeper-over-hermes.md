---
status: accepted
date: 2026-11-26
---

# gtmworks is an interface and a gatekeeper over Hermes

Omar's decision of 2026-11-26 (vault decision 0074, a grill of thirteen questions). It carries [ADR 0017](0017-hermes-keeps-skills-knowledge-rules-steps-and-usage.md) and [ADR 0022](0022-hermes-first-then-the-smallest-change.md) to their end. It supersedes [ADR 0026](0026-one-board-in-gtmworks-working-the-hermes-kanban-way.md), the engine contract of [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md), ADR 0017 where it keeps the chat record in gtmworks, and [ADR 0031](0031-one-way-to-the-engine-and-one-run-lifecycle.md) where it covers Conversations, Channels, Handovers and Good morning.

Not built yet. The code, `GLOSSARY.md` and the tests describe today's product until each spec lands; a spec changes the glossary terms it touches in its own pull request.

## Context

- Omar asked for one thing: his own interface over every feature, power and setting Hermes has, and nothing new built beside it. The aim is marketing run by Agents end to end. The team is the fuel: it teaches the Agents and makes them do and reach more.
- ADR 0017 already said gtmworks is Hermes plus the team layer and the UI. The product grew the other way after it: about 89 tables and 545 database functions, a chat record kept in gtmworks and again in the Engine, and a Run lifecycle written four times (ADR 0031).
- Omar's install on 2026-11-26: one Member, 36 Conversation messages in seven days, no Channel message ever.
- Read in the pinned Engine (Hermes v0.23.0):
  - Its dashboard signs in one owner: one shared credential, no per-person accounts and no Roles. No route checks who the caller is (`hermes_cli/dashboard_auth/`, `hermes_cli/web_server.py`).
  - A session stores no author for a message and cannot be marked as one person's (`hermes_state_common.py`, `gateway/platforms/api_server.py`).
  - Its Kanban board holds tasks, comments, links, attachments, a review status and an event stream. It has no date and no identity on a write (`hermes_cli/kanban_db.py`, `plugins/kanban/dashboard/plugin_api.py`).
  - Its dashboard takes themes and plugins, and runs behind a reverse proxy at a sub-path (`hermes_cli/dashboard_auth/prefix.py`).
  - A plugin registers a tool the Agent calls natively, and its handler receives the session id (`hermes_cli/plugins.py`, `model_tools.py`).

## Decision

**The rule.** What Agents do and keep lives in the Engine, and gtmworks shows it. gtmworks stores only what is about people: who they are, their Role, and what they may see. The gatekeeper is the part of gtmworks that stands before each Company's Engine: sign-in, membership, Role, and the log of who did what.

1. **A Conversation's messages are kept in the Engine only.** gtmworks keeps one row for each Conversation: whose it is. Condition: opening a long Conversation from the Engine meets the targets of [ADR 0030](0030-a-screen-never-waits-on-the-engine.md) on a seeded install. If it does not, the question goes back to Omar with the number.
2. **The board is the Engine's Kanban board.** gtmworks adds the person responsible and the publishing date. The statuses are the Engine's; there is no Live column and no Version. A review works as Hermes does it: an Agent or a person passes the work or sends it back, and the Card shows who. The line "an Agent never approves" ends. A board worker's dangerous command runs (`approvals.single_query_mode: approve`), as [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md) asks.
3. **Channels get no new work.** What is built stays. Their fate is decided when a team uses them.
4. **The Owner opens the Engine's own dashboard** behind gtmworks's sign-in, in gtmworks's colours, for every Hermes page gtmworks does not show: messaging platforms, plugins, webhooks, logs, system. gtmworks draws its own screen only for what a team uses daily.
5. **The four Roles are fixed.** Changing a Role's permissions for a Company, the separate Grants, and hiding an Agent from a Member go.
6. **These go, each with the Engine's own way in its place:**
   - a Handover: an Agent makes a Card for another Agent;
   - Good morning: an ordinary Routine;
   - the rule record and the approval of a lesson: the Agent's own memory, and the Company wiki for what the whole team shares (vault decision 0061);
   - Agent requests, requests to open an Agent and change proposals: a Member asks an Owner.
7. **Lead still makes an Agent from the chat**, for an Owner only, through a tool an Engine plugin registers. Every tool gtmworks gives an Agent is registered that way. None is described in a Run's instructions and read back out of the reply.
8. **These stay in gtmworks:** Roles and invite links, the Activity log, "Waiting on you", an Agent's Look, and a Member's own note.
9. **The engine contract ends.** gtmworks talks to Hermes directly, through the one transport and the handle of ADR 0031.
10. **The move starts clean.** A full backup is kept and no migration is built for the old Conversations and Cards. Nothing is deleted until Omar says so.

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
- The database stays and its tables shrink as the specs land. Replacing it is looked at after the removals, with numbers.
- Paused on 2026-11-26: specs #668 and #669 with their tickets, and tickets #785 to #788 and #790 of spec #761. The rest of #761 carries on.
- Order: three proofs first (the speed of item 1, the dashboard behind the sign-in, a plugin tool that knows its person), then the board, the Conversation, the dashboard, and the removals one by one. Each removal is staged ([ADR 0023](0023-a-change-the-previous-release-cannot-run-against-is-staged.md)).
