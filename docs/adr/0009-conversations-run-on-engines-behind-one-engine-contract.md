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

## What stays from ADR 0008

Everything about the Hermes driver: encrypted profile keys, the allowed addresses, no redirect with a key, the tested-version gate that fails closed, the Connection's owner and RLS, and company agents (#242). Agents still never approve, publish or spend.

## What changes later

How a Company picks its engine, where a non-Hermes engine keeps its home, sign-in and memory, and isolation between companies on one engine, are decided by the tickets that add those drivers.
