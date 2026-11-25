---
status: accepted
date: 2026-11-25
---

# One way to the Engine, and one Run lifecycle that the worker follows

Partly superseded by [ADR 0033](0033-an-interface-and-a-gatekeeper-over-hermes.md) (Omar, 2026-11-26): the one transport and the handle stay; the Run lifecycle for Conversations, Channels, Handovers and Good morning is not built.

A technical decision of the audit of 2026-11-25 (vault decision 0071, where Omar set its order: after specs #668 and #710). It says what the contract of [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md) covers.

## Context

- ADR 0009 holds at the wire: no code outside `lib/hermes.mjs` speaks HTTP to Hermes. But that file is 2 846 lines with 96 exports, 16 of them the contract; 37 files import the other 80 directly and pass a raw `{address, key, profile}`. "The Agent this reader sees, its profile, its Engine" is worked out in 13 places. No caller shares a deadline, a limit on calls at once, or a record of the Engine's health, and a timeout, a refused connection and a lost network all read "unreachable".
- "Reserve, start, read, ask, close" for a Run exists four times: Conversation, Channel, Handover and Good morning. #649 and #581 were one copy drifting from another. A Run's state is polled by the worker every second and by every open browser every 1.5 seconds, though the Engine streams a Run's events, its end included, at `GET /v1/runs/<id>/events` ([ADR 0022](0022-hermes-first-then-the-smallest-change.md): Hermes first).
- The worker read every Agent profile's `SOUL.md` every 2 seconds whether or not a rule had changed.

## Decision

1. **One way in.** Code asks for a handle: the Company's Engine, or an Agent's profile as this reader may see it. Behind the handle one transport keeps the Engine's record, a deadline for each call, a limit on calls at once to each listener, each listener's health, and the cause of a failure. What Hermes can do (Runs, sessions, apps, memory, souls, providers, the Screen) sits behind the handle by capability. The 16 methods do not grow to 96.
2. **One Run lifecycle.** One module starts, follows and closes a Run. A place where a Run happens (Conversation, Channel message, note, Handover, Card) gives it five things: claim, record, close, ask, permit.
3. **The worker alone follows and closes.** It holds the Engine's event stream for each open Run and closes on the terminal event, with a slow read as the safety net. A browser's request never closes a Run or starts a turn.
4. **Upkeep on change.** What gtmworks writes into the Engine (rules, shared skills, souls) is written when what it wants there differs from what it last wrote, with a slow check for drift and a backoff for each Engine. A change of state is logged once, with its cause.

## Considered options

- **Leave the copies and fix each.** Every fix is made four times, and a Card that starts a Run (#685) becomes a fifth.
- **A stream from the database to the browser** (Supabase Realtime or `LISTEN`). Not now: the web container holds no database password on purpose (#446), and reading the record the moment the Steps stream ends meets the one-second target. It is decided with #710's long-lived connection if the numbers ask for it.

## Consequences

- #685 is built on the Run lifecycle of this decision, not before it.
- The tests on the Hermes wire (`tests/fake-hermes.mjs`) stay as they are: they are the second adapter of the real seam. The injected `hermes=`, `driver=` and `engineFor=` parameters go as each capability moves behind the handle.
- With no worker running, no Run closes. The worker's own health becomes something the install shows.
