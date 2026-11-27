---
status: accepted
date: 2026-11-27
---

# Open Design is installed by the Owner, not shipped

> Since 2026-11-26 (#902) the Role these ADRs call **Owner** is named **Administrator / أدمن**: same Role, new word; the code keeps `owner`.

Omar's decision of 2026-11-27 (vault decision 0079, spec #909): «تنزيلة دي حسب رغبة اللي هيحمل gtmworks، وطالما هيعرف ينزل gtmworks يبقي هيعرف ينزل opendesign ويربطه بيه». Open Design is the Owner's to install, and it connects exactly as Hermes connects it: as a command MCP server. This record supersedes [ADR 0025](0025-open-design-draws-with-the-company-engine.md) entirely and the "Open Design" paragraph of [ADR 0024](0024-command-mcp-servers-run-in-the-work-sandbox.md); the rest of ADR 0024 holds. It is reversible.

## Context

- Every install paid for Open Design whether its Owner used it or not: the work sandbox image carried its whole daemon (about 576 MB, built from source), which put the image at about 3.81 GB on disk; every Agent with Open Design on had a second Engine profile (its design profile, `od-<profile>`) with a Run API key of its own, kept in step with the Agent's provider keys and model by every write gtmworks made; and CI carried a whole install area for it.
- Read in Open Design 0.27.2 (tag `open-design-v0.27.2`): it ships its own Docker deployment (port 7456, `OD_API_TOKEN`); its MCP server is stdio only (`od mcp --daemon-url <daemon>`); `od` is published in no registry. Hermes on our own server connects it as a stdio command server running `node …/apps/daemon/dist/cli.js mcp --daemon-url http://127.0.0.1:7456`.
- ADR 0024 already runs any command server in the Company's work sandbox over the Engine's `ssh` route, with Test, Add and on or off per Agent, the Engine profile the only record.

## Decision

- **Nothing of Open Design ships.** gtmworks makes no design profile, keeps no Run API key for one, copies no provider key or model into one and mirrors no later write to one; removing an Agent has no design profile to remove. There is no `sandbox` app source kind. (The image's Open Design build stage, its daemon starter and the `open-design-mcp` wrapper leave the sandbox image in #911, once nothing uses them.)
- **A preset of the command card.** The apps catalogue keeps an Open Design entry (name, logo, content category, a link to `docs/open-design.md`) whose card is the own-tool card in "A command in the work sandbox" mode, filled in with the name `open-design`, the command `node` and the arguments `/work/open-design/apps/daemon/dist/cli.js`, `mcp`, `--daemon-url`, `http://127.0.0.1:7456`, every one editable (`lib/app-catalogue.mjs`). From there it is a command server like any other (ADR 0024): Test lists its tools, Add turns it on for the Agents picked, and the Engine profile is the only record (ADR 0016, ADR 0021). Once a server of that name is in a profile, it is that server's card, under the preset's name and with its guide; no other code path connects it.
- **The guide.** `docs/open-design.md` says where to put Open Design in the Company's work folder, how to build it and start its daemon on loopback inside the work sandbox, the arguments the card fills in, and what to change when Open Design runs elsewhere (the work sandbox must reach that address; the host's loopback is not the sandbox's). Every command in it was run against the version it names.
- **Open Design draws with its own model.** It draws with the model its Owner set up inside Open Design; gtmworks copies no key anywhere and Open Design never draws through the Company's Engine.

## Consequences

- An Owner who wants designs installs Open Design themselves, once per Company, and starts its daemon again after the work sandbox restarts; gtmworks does not start it for them.
- Open Design's model credential, if its runtime needs one, is the Owner's, set inside Open Design, in the Company's work folder: every Member who talks to an Agent with it on reaches what that folder holds, as for any command server (ADR 0024). A subscription sign-in of the Company's Engine is no longer a way to draw.
- No migration: no published release contained the shipped Open Design (no tag holds it), so no installed Company has a design profile to clean up.
- The command server path is proven by the agents install area for any command (ADR 0024); no install proof builds Open Design.
