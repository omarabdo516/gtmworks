---
status: accepted, partly superseded by ADR 0024
date: 2026-11-20
---

# Any remote MCP server by address, and every app with all its tools

Hermes's decision of 2026-11-20 for issue #458, under [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md). Omar: «حته ان انا اوصل للبتاع بام س بي ده مهم جدا». An Agent must reach any tool that speaks MCP, the way Hermes reaches Open Design and T3 Code for him, and the app list must not be a short, read-only one. This is reversible.

## Decision

- **Any remote server by address.** An Owner adds an MCP server with a name, its address (`https`, or plain `http` for a server on the Company's own network) and one of three sign-in kinds: none, a token (sent as a bearer header) or a sign-in (OAuth, coming back through gtmworks's own callback as the catalogue apps do). It is then turned on or off per Agent like every app. The server lives only in the Engine profile of each Agent it is on (ADR 0016): gtmworks keeps no list of its own. A server in an Agent's profile that is not a catalogue entry shows as its own card; removing it takes it out of every profile it is on.
- **No command servers from the web** (superseded by [ADR 0024](0024-command-mcp-servers-run-in-the-work-sandbox.md): a command server runs in the work sandbox). A server given as a command would run inside the Engine's own container, which [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md) keeps clear of Company work. A body with a command is refused before the Engine is asked. Local servers such as Open Design will run in the Company's work sandbox, in their own issue after #389.
- **All tools.** Every catalogue app and every added server gives the Agent every tool it lists. gtmworks writes no `tools.include` filter, and connecting an app that an earlier version wrote with one takes the filter away.
- **The Engine's whole catalogue.** Every entry of the pinned Engine's catalogue (Hermes v0.23.0 `optional-mcps/`, 66 entries, all remote) is offered under the reference's categories, with "More tools" for the ones none fits. Apps whose reads are customer records, and apps that move money, are offered too; their card says that every Member who talks to an Agent with the app on reaches its data.
- **gtmworks's ready-made entries.** Marketing vendors that publish an official remote MCP server are offered as ready-made entries added through the same path, each with its address filled in and its vendor documentation link beside it in the code. A vendor with no official remote server, or one that needs the Owner's own OAuth app registered first, is left out rather than guessed.
- **Secrets.** A token goes only to the Engine (`POST /api/mcp/servers` with `bearer_token`, which keeps it in the profile's `.env`). gtmworks never stores, logs or returns it; the form shows it only as it is typed. Turning a token server on for another Agent asks for the token again, since gtmworks has no copy.

## Consequences

- Every Member who talks to an Agent with an app or server on reaches what that app reaches, writes included. A limit comes only after a real problem Omar names (ADR 0020).
- The read-only list in `lib/app-catalogue.mjs` and its check in the Engine driver are gone.
- An Owner can point a server at any address the Engine can reach, the Company's own network included; the Owner is trusted with that, as with every other Engine power.
