---
status: accepted
date: 2026-11-20
---

# Hermes first, then the smallest change

Omar's decision of 2026-11-20. It widens [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md) and [ADR 0017](0017-hermes-keeps-skills-knowledge-rules-steps-and-usage.md) from data to every feature: gtmworks is Hermes plus the team layer and the UI, so a feature Hermes already has is reached, not rebuilt.

## Context

Ticket #393 (spec #389) spent a day building checks around Hermes's ssh file sync from the outside. The fix was a switch Hermes already has in its code (`sync_files` on the ssh terminal backend) that the pinned release does not expose in its settings.

## Decision

Every ticket in this repo starts by looking for Hermes's own way to do the job: its settings, its tools and backends, its plugins and skills, its API and its management listener, read in the pinned Engine's source.

1. **Hermes has it and it fits.** gtmworks only reaches it: it calls, configures and shows it. Nothing is rebuilt beside it.
2. **It fits a multi-Company install only if it is safe there.** Hermes is built for one person; gtmworks serves many Companies and Members. Before a ready Hermes feature is used, the ticket checks that it moves no data between Companies or between Members who must not see each other's work. If it does, the ticket confines it, or turns it off.
3. **Hermes needs a change.** The smallest one, in this order: a setting, then a plugin, skill or API call, and last a change to Hermes's own code. A code change is carried as a small patch on the pinned Engine image, one patch per purpose, with a comment saying it is removed when the pin moves to an upstream release that has it. The same change goes to upstream Hermes (`NousResearch/hermes-agent`) as a pull request with its test.
4. **The PR says which.** Its `## Decisions` names the Hermes feature used, or why none fitted, and any patch it carries.

## Consequences

- Each ticket spends a little more time reading Hermes first. That costs less than building something Hermes has.
- The Engine image can carry patches until upstream releases them. Every patch is small and has its removal named, so a pin bump drops it.
- Upstream pull requests are public and opened from Omar's account. Omar approved them once for every such change, on one condition: a patch carries no customer data, secret or business detail.
