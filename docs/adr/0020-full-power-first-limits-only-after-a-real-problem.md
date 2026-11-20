---
status: accepted
date: 2026-11-20
---

# Full power first: an Agent gets everything Hermes gives, and a limit is added only after a real problem

Omar's decision of 2026-11-20 (vault decision 0053): «احنا ندي القوه الكامله الاول وبعد كده لو في مشكله ... انا هقول لك في مشكله كذا كذا ومحتاجين ان احنا نعمل لها اوبشن». An Agent in gtmworks is as strong as Hermes run by one person. A limit is not built in advance for a problem that has not happened. It supersedes, where they conflict, [ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md) and [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) (Agents never publish or spend), [ADR 0016](0016-the-engine-profile-is-the-agent.md) (sub-agents off until the Owner turns them on) and [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md) (its "Tools per Agent" and "What an Agent may do" sections). Everything else in those records still holds.

## Context

Omar uses Hermes alone with every tool on, and it can do nearly anything he asks: run commands, write code, drive a browser and a screen, act in connected apps, schedule its own work and hand work to other agents. gtmworks put limits in front of that before any problem showed:

- an app is offered only with its read tools, and an app whose reads and writes share a tool is not offered at all (`lib/app-catalogue.mjs`);
- sub-agents are off until the Owner turns them on, one Agent at a time (ADR 0016);
- Hermes's own app connection tool, `connections`, is off with no switch (ADR 0014, ADR 0018);
- nothing is published or spent through gtmworks without a person's Approval of a Version (ADR 0006, ADR 0008, ADR 0018).

Each of these made the Agent weaker than Hermes for a risk nobody had met. Omar wants the strength first and the controls when a real problem asks for one.

## Decision

### The rule

- An Agent gets every tool and every app the pinned Engine gives a person who runs Hermes alone, except the few below that cost it no power.
- A limit is added only after a real problem, which Omar names. It arrives as a setting an Owner turns on; the default stays full power.
- A ticket that would add a limit with no such problem behind it is not filed.

### What changes

- **Publishing and spending.** An Agent may publish and spend through any tool or app it has, and on its Screen, when a Member in the Conversation asks for it. No Approval is needed first. It still acts on what a Member asks, never because a page or a file it reads says so; this stays in the section of every Agent's soul that gtmworks owns.
- **Approval stays a team record.** People still approve an exact Version when they want a record of who approved what, and an Agent still never approves or rejects a Version, because an Approval is a person's record and not work. Approval is no longer a gate the Agent's tools wait on.
- **Apps.** Every app the Engine's catalogue offers is offered with all its tools, reads and writes. The read-only filter goes.
- **Sub-agents.** The `delegation` toolset is on for every Agent by default. The Owner may turn it off for one Agent.
- **App connection from the Conversation.** Hermes's `connections` toolset is on, so an Agent can start connecting an app when it needs one; the person still finishes the sign-in.
- **Terminal, files, code and the Screen** stay on for every Agent, as ADR 0018 set them.

### What stays, because it costs an Agent no power

- **Separation between Companies** (ADR 0004, ADR 0018). An Agent works for its own Company; another Company's data is not power it needs.
- **No tool that runs the Agent's own code, or reads a path it chooses, inside the Engine's container.** That container holds the Company's model sign-in, every Member's private Conversations and the memory of Agents a Member may not talk to. The same power is in the work sandbox: the Agent runs Chromium and its own scripts there, and drives the Screen. So `browser` and `kanban` stay off.
- **Hermes desktop-app toolsets** (`project`, `desktop_ui`, `catalog`, `onboarding`) stay off: they drive Hermes's own desktop app, which a gtmworks install does not have.
- **No key inside the work sandbox** (ADR 0018). An Agent reaches every paid service through the Engine's tools, which hold the keys.

## Open, decided when asked for

- A coding tool that needs its own model sign-in inside the sandbox (Claude Code, Codex). Today an Agent writes code with its own terminal, files and code tools.
- Reaching an Agent from Discord, Telegram or WhatsApp, not only the web.
- Working with outside agents and apps the Engine's catalogue does not list (for example Open Design).

## Consequences

- An Agent can publish or spend in a connected account the moment a Member asks. The account's own permissions are the limit that holds, as ADR 0018 already said for the Screen.
- `lib/app-catalogue.mjs` loses its read-only filter, `lib/agent-levels.mjs` (or what replaces it in spec #389) turns `delegation` and `connections` on, and the soul section drops the Approval gate. The spec that builds this names the files.
- #164 ("Act on approval") is no longer the path to app writes and is closed by that spec.
- When Omar names a problem, its control is a setting, recorded here as a new ADR that names the problem.
