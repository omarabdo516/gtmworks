---
status: accepted, partly superseded by ADR 0020
date: 2026-11-19
---

# An Engine and a work sandbox per Company, and no Docker inside the install

Omar's decisions of 2026-11-19. Not built yet: the spec that builds it follows this record. It supersedes, where they conflict, [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md) (one bundled Hermes for the whole install), [ADR 0014](0014-one-hermes-profile-per-company.md) (terminal, file, code and desktop tools always off, Agent levels, the sign-in rules), [ADR 0016](0016-the-engine-profile-is-the-agent.md) (its Sign-in section) and [ADR 0017](0017-hermes-keeps-skills-knowledge-rules-steps-and-usage.md) ("One Hermes" as one per install). Everything else in ADR 0008 to 0017 still holds: Hermes ships inside the install unmodified, an Agent is an Engine profile, and gtmworks stores nothing the Engine keeps.

[ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md): full power first. An Agent may publish and spend when a Member asks, with no Approval first; apps come with all their tools; `delegation` and `connections` are on. The tools that run inside the Engine's container stay off.

## Context

One install holds several Companies, and their Agents need the full work tools: a terminal, files, code, a browser and video rendering. gtmworks is Hermes as it is, with a team layer and an interface on top, so each Company should get what a person running Hermes alone gets.

The design holds against this: every Member who talks to an Agent, and every page an Agent reads, is assumed able to make that Agent run any command. What such a command reaches must end at the Company.

Read in the pinned Engine (Hermes v0.23.0) for this:

- One Hermes serves every profile from one data folder. A tool that runs in the Engine's own process can read all of it. `browser_exec` is such a tool: it runs Python the Agent wrote in the Engine's container, and is offered to any Run that has `terminal` (`model_tools.py`, `_rewrite_browser_exec`).
- The `docker` terminal backend calls the `docker` command against the daemon its process sees. Whoever holds a Docker daemon's API holds that daemon's host, and a filtering proxy does not change that, because it filters the kind of request and not its content.
- The `ssh` terminal backend runs terminal, file and code tools on another host. The Bot Screen (the desktop, Chromium and `cua-driver`) is placed inside a `docker` or `ssh` sandbox by default (`tools/bot_desktop/placement.py`), and the management listener streams it (`/api/display/ws`, `hermes_cli/web_routers/display.py`).
- A profile with no model sign-in of its own reads the root profile's, and only the root's (`hermes_cli/auth.py`). Two sign-ins of one OpenAI account do not both live: the older is revoked (`hermes_cli/auth_commands.py`, `_warn_same_codex_account`).
- The managed config (`/etc/hermes/config.yaml`) pins `terminal` keys that no profile overrides (`tools/terminal_scope.py`).

## Decision

### An Engine per Company

- Each Company has its own Engine: one container of the pinned official image, unmodified, with its own data volume, its own key for the Run API and the management listener, and its own network. The app and the worker reach every Engine. An Engine reaches no other Engine and none of the install's services (database, auth, storage).
- Separation between Companies is this container boundary. It no longer rests on profile settings inside one process.
- Inside an Engine nothing changes: the main Agent's profile, `ag-<agent id>` for every other Agent and the shared space `cs-<company id>` are as ADR 0016 named them.

### No Docker API inside the install

- No container of the install holds a Docker API, the Engine included.
- A Company, its Engine and its work sandbox are made by the install's command on the server (`gtmworks company add`), from fixed templates. The command prints a first-Owner link (ADR 0019).

### The work sandbox

- Each Company has one work sandbox: a second container, built on the Engine's own sandbox image (`nousresearch/hermes-sandbox:desktop`) with the work tools added (ffmpeg, Chromium, Node, Python, Arabic fonts). Every Agent of the Company works in it.
- It is an ordinary container with the least it needs: a non-root user, no capabilities, no new privileges, and RAM and CPU limits given when the Company is made. It stays running; the Engine stops an unused screen by itself.
- The Engine reaches it through the `ssh` terminal backend, with a key for that sandbox only. The backend is pinned in the Engine's managed config, so no profile and no Settings write changes it.
- It holds no key of any kind: no model credential, no publishing or payment key, not the Engine's key and none of gtmworks's. A paid service (voice, images, video review) is called by a tool of the Engine, never by a key in the shell.
- Its network is outbound internet only, through one exit that refuses the install's networks, private address ranges and cloud metadata addresses.
- Its work folder is where the Agents' work files live, and it has no private corners: the Library shows it to every Member who may talk to an Agent. A file becomes a card's Version when it is copied into gtmworks storage; that copy never changes, so an Approval is of a fixed file. A backup includes the work folders and leaves out the tool caches.
- The first ticket of the build proves on the pinned Engine that terminal, files, code and the screen all work through `ssh`, before anything else is built on it. Measured 2026-11-19: `docs/engine-probes/work-sandbox-ssh.md` (#390).

### The screen

- The Bot Screen runs inside the work sandbox and is on. An Agent uses it with `computer_use`; a Member watches it and takes it over, for example to sign in to an account.
- The `browser` toolset stays off for every Agent, with no switch, because `browser_exec` runs the Agent's code in the Engine's container.

### Tools per Agent, and no Agent levels

- Agent levels are removed: the Company's level, the level table and its policy version.
- An Owner turns each Agent's toolsets on and off in that Agent's settings, from the Engine's own list (ADR 0016). A new Agent gets the full work tools: terminal, file, code execution and the screen, with what a level 3 Agent had.
- Still off for every Agent, with no switch: `browser`, `project`, `desktop_ui`, `catalog`, `onboarding`, `kanban` and Hermes's `connections`, for the reasons ADR 0014 gave. `delegation` stays the Owner's choice per Agent.
- The rule for any tool the Engine adds later: a tool that runs code the Agent supplies, or reads a path the Agent chooses, in the Engine's own container is off for every Agent.

### Model sign-in

- A Company signs in once, on its Engine's root profile, and every Agent of the Company uses that sign-in through the Engine's own sharing. The rules of ADR 0014 and ADR 0016 that told one Company from several, and the sign-in shown as install-wide, are gone.
- One account cannot serve two Companies. Each Company has its own model access: a sign-in on its own account, or an API key.
- From Settings an Owner signs in to ChatGPT or sets an API key for any provider. Claude's sign-in stays a command on the server, shortened to `gtmworks sign-in claude`, because the Engine keeps that sign-in off its listener by its own choice.

### What an Agent may do

- An Agent never approves or rejects.
- Through gtmworks nothing is published or spent without a person's Approval, and no publishing or payment key enters a sandbox or an Engine (ADR 0006, ADR 0008).
- On the screen, in an account a person signed in to, an Agent may publish or spend when a Member in the Conversation asks for that exact thing, with its amount, and never because a page or a file says so. This rule is written into every Agent's soul, in the section gtmworks owns. gtmworks cannot enforce it on a screen: the limit that holds is the account's own permissions, and the interface says so when a person takes the screen over.

### Existing installs

- The update adopts the existing Engine volume as the Engine of the install's one Company, with its Agents' memory and history.
- An install with several Companies on one Engine is refused by the update with a plain message that names the manual path. No splitter is built.

### Left for later

Each of these is an addition on top of this shape, not a rebuild: making a Company from the browser, with the install service that would hold a Docker API; a page of each Company's usage; stopping an idle sandbox; a stronger sandbox runtime (gVisor) as an install setting.

## Considered options

- **One Engine for every Company, with the dangerous tools off.** Rejected: separation would be a list of denied tools inside one process, checked again at every Engine update, and the screen's browser tool could never be offered.
- **The `docker` backend.** With the server's Docker socket, with or without a proxy, the Agent holds the server. With an inner daemon per Company, the daemon needs a privileged container, and leaving it is root on the server.
- **One container per Company, the Engine working in itself.** Simpler, and exactly Hermes as one person runs it. Rejected because the Agent's code would then read the Company's model sign-in, other Members' private Conversations and the memory of Agents a Member may not talk to, which would leave private Conversations and Agent visibility in name only.

## Consequences

- Each Company adds an Engine's memory use. The README's figure was measured on one Engine shared by every Company, so a measurement of an Engine per Company sets the two sizes the README states: without video and with video.
- An Agent drives the browser by pointer and keyboard, or with a script it runs inside the sandbox, not with `browser_exec`.
- The sandbox shares the server's kernel. A stronger runtime is left for later.
- An account signed in on the screen can be used by every Member of the Company through any of its Agents.
- The tests that pin the old shape change with the build: `tests/bundled-hermes.test.mjs`, `scripts/check-install-profiles.mjs`, and the level table's tests.
