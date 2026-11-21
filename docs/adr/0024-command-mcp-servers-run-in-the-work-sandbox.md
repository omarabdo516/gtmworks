---
status: accepted
date: 2026-11-21
---

# Command MCP servers run in the work sandbox

Hermes's decision of 2026-11-20 for issue #459, under [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md). Omar wants an Agent to use Open Design the way Hermes does for him, and any MCP tool that runs as a local command. [ADR 0021](0021-any-remote-mcp-server-and-every-app-with-all-its-tools.md) connected remote servers by address and refused a command, because the Engine starts a command server as a process of its own container, which [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md) keeps clear of Company work. This record gives a command server its place: the Company's work sandbox. It supersedes ADR 0021's "No command servers from the web" and keeps the rest of it. It is reversible.

## Context

Read in the pinned Engine (Hermes v0.23.0):

- A stdio server is `{command, args, env}` in a profile's `mcp_servers`; `POST /api/mcp/servers` takes exactly one of an address or a command, and no HTTP sign-in for a command (`hermes_cli/web_server_mcp.py`). The Engine spawns the command as its own child with a filtered environment (`tools/mcp_tool_transport.py`, `tools/mcp_tool_config.py`), and refuses only three narrow shapes of command (`hermes_cli/mcp_security.py`).
- The Engine image carries the OpenSSH client its `ssh` terminal backend uses, and the install seeds the key and the sandbox's host key that backend reads (`scripts/install.sh`).

## Decision

- **Where it runs.** A command server runs inside the Company's work sandbox, started by the Engine over the same `ssh` route the terminal backend uses: the Engine's own key, the work user `pn`, port 2222, and the known_hosts the install pins, with strict host key checking. It is never a process of the Engine's container.
- **How the Engine gets it.** gtmworks writes the server as `ssh` with that fixed route; ssh's options end before the host, and the Owner's command and its arguments are the one remote command after it, each word quoted for the sandbox's shell (`lib/sandbox-command.mjs`). Nothing the Owner types is read by ssh as an option or by a shell as more than one word. The command starts in the Agent's own folder of the Company's work folder, which the sandbox's login shell makes from the same `builtin cd` the terminal backend sends, so a file it writes is where that Agent's other work is.
- **What the Owner gives.** In the apps sheet's own-tool card, the Owner picks "A command in the work sandbox" and gives a name, the command (one program name or path) and its arguments, one per line. Test lists its tools without leaving it; Add turns it on for the Agents picked. It is on or off per Agent like every app. The Engine profile stays the only record (ADR 0016, ADR 0021): the card reads the command back from the server entry, and turning it on for another Agent copies the command, so that Agent's copy starts in its own folder.
- **What stays refused.** A command beside an address, a command with a space or a control character, and any command for a remote kind are refused before the Engine is asked.
- **Open Design.** A ready-made entry: the sandbox image carries it, its daemon runs in the sandbox, and its MCP command (`od mcp --daemon-url <daemon address>`, stdio) is connected through this same path for the Agents the Owner picks. Open Design's model access is the Company's own, made available inside the sandbox for the Open Design daemon. This is the first key inside the sandbox: under ADR 0020 the no-key rule of ADR 0018 gives way where it costs an Agent power, and Open Design cannot make a design without a model. It is built in its own issue (#544), because Open Design 0.27.1's `od` command is not published as a package (the npm `open-design-ade` launcher ships the daemon and its web UI without it) and has to be built from Open Design's source into the sandbox image, and because a Company whose model access is a subscription sign-in cannot share that sign-in with a second client without the first being revoked (ADR 0018), which leaves a choice for Omar.

## Consequences

- Every Member who talks to an Agent with a command server on reaches what that command reaches inside the sandbox, which is what the Agent's own terminal already reaches there (ADR 0018). The command needs no further limit until Omar names a problem (ADR 0020).
- The Engine's malware check of a package fetched by `npx` or `uvx` keys off the command it spawns, which is `ssh`, so it does not see a package such a command fetches inside the sandbox. The sandbox reaches the internet through its exit only and holds no key.
- A Run reaches a command server's tools as it reaches every MCP server's, through the pinned Engine's tool search: `tool_search` lists them by name (`mcp__<server>__<tool>`) and `tool_call` invokes them (`model_tools.py`). A server added to a profile reaches Runs when the Engine's own MCP reconcile connects it, a housekeeping chore every 60 s whose first tick only primes (`gateway/run_profile_reconcile.py`): about two minutes on a quiet Engine here, and from under half a minute to over four minutes in CI; a server removed is closed the same way, and an Engine connects every configured server when it starts. The install proof restarts its Engine after adding the server so its call does not wait on that tick. Measured on v0.23.0 for #459; gtmworks changes nothing there, and the same holds for every app #458 connects.
- An Owner places the program a command server runs in the work folder or uses one the sandbox image carries; nothing is installed for it.
- The install job proves it: a small stdio server placed in the work folder is added through the driver, Test lists its tool, an Agent calls it from a Conversation, and while the call holds the server is a process of the sandbox and the Engine holds only the ssh client (`scripts/ci-install-check.sh`, agents area).
