---
status: accepted
date: 2026-11-25
---

# A screen never waits on the Engine

Omar's decision of 2026-11-25 (vault decision 0071). It keeps [ADR 0017](0017-hermes-keeps-skills-knowledge-rules-steps-and-usage.md) and changes how its reads are placed on a screen.

## Context

ADR 0017 made the Engine the only store of Steps, usage, skills, souls and memory, and said opening a chat "must stay under 1 second". On the production install on 2026-11-25 the `chat_opened` line showed 9.8 seconds to the first byte on a busy server, the Engine session read took up to 7.9 seconds, and the Agent details panel 5.5 to 10 seconds. The cause was placement: the chat's record awaited the whole Engine session before returning the messages gtmworks itself stores, and the details panel was one promise that waited on the Memory tab's reads.

The audit proposed keeping a closed Run's Steps and usage with its reply in the database. Omar chose not to: a second copy is what ADR 0017 removed, and the same speed for what a person reads comes from order alone.

## Decision

1. **What gtmworks stores is drawn first.** A page's first content comes from the database only. No server render, and no poll, awaits a read of the Engine before it returns what the database holds.
2. **What the Engine keeps arrives after, each part on its own.** Steps and usage under a reply, an Agent's Memory, its permissions, its apps, a Company's models: each is its own request, started after the first content, or when its tab is opened.
3. **The last good read stays.** A part the Engine backs shows what it last read while it reads again, and keeps it when the Engine does not answer. Listing is never held by a test: the apps list shows at once and each app reads "checking…" until its own test answers.
4. **gtmworks still keeps no copy** of anything in ADR 0017. The last good read lives in memory, in the browser and in the web process, never in a table.

## Consequences

- "Used N tools" can appear a moment after its reply. If it is still more than one second late three days after the release that carries this, the question of keeping closed-Run Steps comes back with that number.
- A person can see a value up to about a minute old in an Engine-backed part.
- ADR 0017's line "Opening a chat reads the Hermes session. It must stay under 1 second" now reads: opening a chat draws without the Hermes session, and its first byte stays under 1 second at p95 on a busy server.
- A new screen that needs something the Engine keeps adds a part of this kind, not an awaited read in its page.
