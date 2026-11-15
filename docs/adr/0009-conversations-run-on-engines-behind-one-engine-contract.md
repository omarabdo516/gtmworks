---
status: accepted
---

# Conversations run on engines behind one engine contract; Hermes is one driver

Partly superseded by [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md) (#282): Hermes ships inside the install and is the engine; the Codex and Claude Code drivers below are no longer planned. The engine contract still holds.

Omar's decision of 2026-11-11 (vault `decisions/general/2026-11-11-gtmworks-engine-layer-trial.md`), after spike #271 ran a gtmworks conversation on the Codex CLI with no Hermes. Ticket #274. This partly supersedes [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md): Hermes is no longer the only engine, and once a second driver lands it is no longer required for anyone.

## Decision

- gtmworks drives the agent engine of a conversation itself, through one engine contract in `lib/engine.mjs`. Hermes is its first driver (`lib/hermes.mjs`); Codex (through `codex app-server`) and then Claude Code are added as drivers behind the same contract in later tickets.
- A non-Hermes engine runs on the company's own sign-in (for example its ChatGPT sign-in for Codex). gtmworks never supplies its own model credentials.
- gtmworks writes no model loop of its own: an engine is an existing agent program that gtmworks starts, reads and stops.
- The contract carries what a conversation needs and nothing more: start a run for a conversation with an idempotency key (a retry never starts a second run), read a run's state (running, completed with the reply, failed, stopped, lost, unreachable) with the usage the engine reported (unknown, never zero, when it reported none), and stop a run. Its states map to the existing conversation-run outcomes (`outcomeOf`), so a reply is still stored once (#243) and usage is still recorded per company (#245).
- Only a driver talks to its engine. The conversation code (`lib/conversation-runs.mjs`, the conversation route and the worker) calls the contract, never Hermes's API. Until a second driver exists, an agent's engine is still found through its Hermes Connection (`hermes_connections`, ADR 0008).
- A fake engine (`tests/fake-engine.mjs`) speaks the contract in memory, so conversation tests run with no subscription and no network.

## Tools (#13, 2026-11-15)

- gtmworks offers tools to a run through the same contract: a run may carry tool specs (name, description, JSON Schema arguments), and a completed run reports the calls its model made. The model decides when to call one; gtmworks decides whether the call is allowed when it carries it out, in the database, from the Conversation's person and Agent at that moment (`lead_create_agent`). Lead's first tool, `create_agent`, is offered only to an active Owner talking to the Company's main Agent on the Company's own profile, and the offer is pinned with the run's note so a retry sends the same request.
- An Agent's second tool, `save_rule` (#18), keeps a lasting rule a person told it, such as «من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها». It is offered to a run of any Agent of the Company while its person is an active Owner or Manager (`agent_save_rule` checks that again when the call is carried out). Which tools a run is offered is pinned by name at its first reservation (`conversation_run_notes.tools`, read through `pinned_run`), with the Agent's rules in force (`rules`); every run of that Agent, whoever writes to it, starts with those rules in its `instructions` before its sender's note, and a retry sends them unchanged. An Owner or a Manager removes a rule from the Agent's page; it is kept as removed, and both the save and the removal are in the Company's log.
- The Hermes driver offers the tools in the run's `instructions` with a fixed reply format and reads the calls back out of the reply, because Hermes v0.23.0's `/v1/runs` takes no tools from the caller and its MCP client sends the same headers for every run of a profile, so an MCP call could not say which Conversation made it. A later driver maps the same contract to its engine's own tool calls.

## What stays from ADR 0008

Everything about the Hermes driver: encrypted profile keys, the allowed addresses, no redirect with a key, the tested-version gate that fails closed, the Connection's owner and RLS, and company agents (#242). Agents still never approve, publish or spend.

## What changes later

How a Company picks its engine, where a non-Hermes engine keeps its home, sign-in and memory, and isolation between companies on one engine, are decided by the tickets that add those drivers.
