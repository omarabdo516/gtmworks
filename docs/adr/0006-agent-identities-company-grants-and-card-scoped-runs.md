---
status: accepted
---

# Agents have their own identities, company grants and card-scoped runs; the dashboard runs no AI

Decisions: Omar, 2026-11-06/07. Today's runtime design is in [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) and [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md).

## Decision

Update: [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) supersedes runtime-neutral execution and dispatch below. gtmworks now holds encrypted Hermes profile keys and calls Hermes directly; the existing agent API remains transitional. The no-model and human-approval rules remain.

- Each role agent speaks under its own named identity. One agent per role serves multiple companies through separate, revocable company grants managed by that company's Owner; no grant means no access.
- Each run receives a short-lived credential scoped to one company, one card and that run. A company grant is necessary but cannot widen a run's authority. Expired or revoked authority fails closed; a credential cannot reach another card, even in the same company.
- Agent identities, company grants and run records live in the existing Supabase database. The shared role identity is company-independent; grants, runs and their audit rows carry company_id and obey RLS and checked RPCs ([ADR 0004](0004-one-database-company-on-every-row-rls-and-worker-layer.md)).
- The dashboard and its worker run no AI and hold no model credentials. Hermes is the only agent engine and owns agents, their settings, skills, scheduled work and memory. gtmworks calls Hermes directly under ADR 0008; the existing agent API remains transitional.
- Agents produce, reply and attach versions. They never approve, reject, publish or spend. Approval is an authorized person's action on one exact version; changing the output requires a new approval. The audit records identity, company, card, run and version where relevant.

## Consequences and delivery

The existing company/member API keys are the current implementation, not run credentials; their five-minute internal JWT does not limit access to one card. Company grants ship with #77: an Owner grants and revokes each role agent per company under Team > Agents, a revoked grant keeps its row with who revoked it and when, and a role agent's key resolves only while its grant is active, and the database refuses to activate a role agent's membership without one, so an invitation cannot bring it back. Run credentials ship with #78: `gtmw_run_` keys for one card, short-lived, revoked with the grant. They are `agent_keys` rows of kind `run`, so rate limits, refusals and last-used tracking are shared. Existing `agt_` keys keep working during an explicit transition, every answer to one carries `Deprecation: true`, and removal is announced before a breaking API version.

Runs will use dispatch keys, fenced leases, heartbeats, a watchdog and explicit retry; recovery continues the same card. These are planned controls, not guarantees of today's API. The [OpenAPI contract](../api/openapi.yaml) marks proposed run routes as planned; [version policy](../api/README.md) distinguishes documentation from deployed behavior.

## Alternatives

One identity per company loses specialist attribution; a permanent company-wide key per agent cannot constrain a single execution. Both are replaced by independent identities, company grants and per-run authority. The no-AI and human-approval decisions above remain binding.
