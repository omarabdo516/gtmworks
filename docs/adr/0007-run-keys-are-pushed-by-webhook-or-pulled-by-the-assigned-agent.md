---
status: accepted
---

# Run keys are pushed by webhook, or pulled by the assigned agent

Settles a finding on #78 (Hermes, 2026-11-09). Builds on [ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md).

## Decision

Update: this is the legacy agent-API delivery path. [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) replaces it for new work: gtmworks holds encrypted Hermes profile keys, starts Hermes runs directly and relays their events. Existing run keys continue during transition; no new dispatch engine is built here.

- Assigning a card to an agent makes the agent eligible for a run key for that card. The secret itself is minted at delivery, because a key is shown once and stored only as a SHA-256 hash, so there is no place to keep it between the assignment and the agent.
- If the company has a webhook, the key is pushed: the worker adds it to the signed `assigned` request, over HTTPS only.
- If it has none, the agent pulls it: `POST /cards/{card}/run-keys` with its company key succeeds only for a card currently assigned to that agent (next actor or assignee), and returns 403 for any other card.
- No polling endpoint hands out fresh keys for newly assigned cards. Hermes already polls for its assigned cards, and Paperclip uses the same pull model.

## Consequences

- A company without a webhook needs one extra request per run, made by an agent that already holds a company key.
- A pulled key is issued under the same rules as a pushed one: it expires, reaches one card and ends with the agent's company grant.
- A poll endpoint can be added later without breaking this one.
