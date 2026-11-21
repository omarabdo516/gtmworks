---
status: accepted
date: 2026-11-21
---

# Open Design draws its designs with the Company's own Engine

Omar's decision of 2026-11-21 on issue #544, with Hermes's route, under [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md) and [ADR 0022](0022-hermes-first-then-the-smallest-change.md). [ADR 0024](0024-command-mcp-servers-run-in-the-work-sandbox.md) put Open Design in the work sandbox as a ready-made app and said its model access would be the Company's own key copied into the sandbox. Omar decided instead that Open Design must work for a Company whose only model access is a subscription sign-in, and that no sign-in or key is copied into the sandbox: Open Design's model calls go to the Company's own Engine. This record supersedes ADR 0024's "Open Design" paragraph where they differ; the rest of ADR 0024 holds. It is reversible.

## Context

Read in Open Design 0.27.1 (tag `open-design-v0.27.1`, commit `b83646f4afb9b21b415d98c4d073477d077d7943`):

- Its MCP server only steers the daemon (create a project, start a run, read it). The design is drawn by an agent CLI the daemon starts for each run; one of them is Hermes, started as `hermes acp --accept-hooks` and found through `HERMES_BIN` (`apps/daemon/src/runtimes/defs/hermes.ts`, `runtimes/executables.ts`). The daemon speaks ACP to it over stdio: `initialize`, `session/new` with the project folder as `cwd`, an optional model choice, then `session/prompt`, and it takes the agent's text and the files left in that folder (`agent-protocol/acp/session.ts`). It answers every permission request itself.
- The daemon reads its default runtime from `app-config.json` in its data folder (`OD_DATA_DIR`), keeps every project under `<data>/projects/<id>`, and listens where `--host` and `--port` say.
- `od` (the daemon's `dist/cli.js`) is published in no package. Built from the workspace's lockfile and deployed with its production dependencies, the daemon is 576 MB and runs on the sandbox base's own Node 26 with its native modules built there.

Read in the pinned Engine (Hermes v0.23.0):

- A named profile's Run API takes only that profile's own `API_SERVER_KEY` and fails closed without one (`gateway/platforms/api_server.py` `_check_auth`). A profile with no model sign-in reads the root profile's (`hermes_cli/auth.py`).
- `/v1/chat/completions` takes no tools from the caller, so the Engine cannot stand in as a bare model for an agent CLI that calls its own tools; a Run on a profile is the Engine's whole agent, whose file tools write into the work sandbox over the `ssh` backend.
- The Engine's listeners bind the install network's address alone, so the sandbox cannot reach them (#390, `scripts/engine-listener-address.sh`). The Engine's own name resolves inside its container to that address.

## Decision

- **The design runtime is the Company's Engine.** The sandbox image carries gtmworks's `hermes` for Open Design (`sandbox/open-design/hermes-engine.mjs`): an ACP agent with no model and no provider credential. Each prompt becomes one Run on the Agent's design profile, told its project folder; the Run's text becomes the agent's answer, and a permission the Run asks for is given once, as Open Design's own client answers every one. The Engine answers with the Company's model access, so a subscription sign-in works as an API key does, and the sign-in is never shared with a second client.
- **One design profile per Agent.** Turning Open Design on for an Agent makes `od-<Agent's profile>` on the Company's Engine: a profile of its own with a Run API key of its own (32 random bytes, never the install's key), the Agent's work tools and none that stay off, its terminal in the Agent's own folder of the work folder (`lib/open-design.mjs`, `prepareOpenDesign` in `lib/hermes.mjs`). It draws with its Agent's model access, copied inside the Engine when the app is turned on: each provider key the Agent's profile holds (read on the Engine's reveal route, written straight into the design profile, never leaving the Engine and gtmworks's process), and the Agent's provider and model. A subscription sign-in needs no copy: it is the Engine root's, which every profile reads. A custom endpoint the Owner configured in the Engine itself is not copied, since no route gives that config back whole. Every later write gtmworks makes to an Agent profile's model or provider key is made to its design profile too (`designProfiles` in `lib/hermes.mjs`). The design profile's Run API key is the one key in the sandbox: it runs that one profile, which holds no Conversation of any Member and reaches the sandbox the Agent's terminal already reaches. Turning it on again keeps a key the profile still takes. Turning it off for the Agent, or removing the Agent, removes the design profile.
- **The Engine reaches out; the sandbox reaches nothing new.** The Open Design server entry is the terminal backend's ssh route (ADR 0024) with one addition: `-R /home/pn/.gtmworks/engine-<profile>.sock:<Engine name>:8642` and `ExitOnForwardFailure=yes`. While the Engine holds the Agent's Open Design session, that socket in the work user's home reaches its Run API; the Engine's listeners and networks are unchanged. sshd takes forwarded sockets only from the remote side and replaces one a session left behind (`sandbox/sshd_config`). The remote command is `open-design-mcp <design profile> <key>`, each word quoted.
- **One daemon per Agent, in its own folder.** `open-design-mcp` (with `sandbox/open-design/daemon.mjs`) keeps the Agent's route in the work user's home, never in the work folder the Library shows; moves the socket its session forwarded to a name of that session's own, so a second session (the Owner's Test while the Agent is connected) cannot take the first one's away; starts the Agent's daemon on loopback with `open-design` in the Agent's folder as its data folder and Hermes as its runtime, unless one already answers; then becomes Open Design's own `od mcp` for that daemon. A design is therefore a file in the Agent's own folder of the Company's work folder, `open-design/projects/<id>/`, and in the Library.
- **The image.** `sandbox/Dockerfile` builds Open Design from that commit in a stage on the same pinned base (ADR 0020's one base image), installs the workspace from its lockfile and keeps only the deployed daemon, at `/opt/open-design/app`.
- **The card.** Open Design is a ready-made app of its own kind, `sandbox`, in the content category, with nothing to sign in to, on or off per Agent like every app.

## Considered options

- **Copy the Company's key into the sandbox** (ADR 0024 as written). Rejected by Omar: it fails a Company on a subscription sign-in, which revokes the Engine's own when shared, and it puts a provider credential in the sandbox.
- **The Engine as a bare model for another agent CLI** (OpenCode with a custom address, or a second Hermes in the sandbox with a custom provider). Rejected: the Engine's OpenAI routes run its own agent and drop the caller's tools, so the CLI in the sandbox would never write a file; two agents would answer one prompt.
- **The Engine's Run API on the work network.** Rejected: the listeners bind the install network alone so that no sandbox reaches them (#390); one socket that the Engine's own session forwards keeps that.
- **The Agent's own profile as the design profile.** Rejected: every profile of an Engine takes the install's key, and holding it in the sandbox would reach every Agent's sessions, which is what ADR 0018 keeps out of the sandbox.

## Consequences

- Each Agent with Open Design on has a second Engine profile and, once used, a daemon of about 150 MB of memory in the sandbox. The work sandbox image grows by Open Design's daemon (the install job prints its size) and its build fetches Open Design's source and its packages.
- A design Run uses the Company's model like any Run, and shows in the Company's usage on its design profile.
- Open Design can be asked for a design only while the Engine holds the Agent's Open Design session; the runtime says so in words when it cannot reach the Engine.
- The install job proves it: an Owner's turn-on through the driver, an Agent asking for a design from a Conversation and the design's file in the Agent's folder of the work folder, the daemon and `od mcp` as processes of the sandbox and the Engine holding only the ssh client, and no provider credential in the sandbox's environment or files (`scripts/ci-install-check.sh`, agents area).
