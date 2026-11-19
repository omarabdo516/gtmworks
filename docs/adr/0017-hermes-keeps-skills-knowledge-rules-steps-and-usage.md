---
status: accepted
date: 2026-11-18
---

# Hermes keeps skills, knowledge, rules, run steps and usage; gtmworks keeps the team layer

Spec #340, decisions 0040 and 0042 (Omar, 2026-11-18): gtmworks is Hermes itself plus the team layer and the UI, and stores nothing Hermes already keeps. It supersedes [ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md) and [ADR 0007](0007-run-keys-are-pushed-by-webhook-or-pulled-by-the-assigned-agent.md) where they describe the external-agent API, and [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) where it describes pasted Hermes connections. Everything else in ADR 0009 to 0016 still holds.

[ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md): "One Hermes" below now means the bundled Hermes is the only kind of Engine; each Company has its own.

## Context

Hermes ships inside the install and is the Engine (ADR 0010). Each Agent is an Engine profile (ADR 0016), and Hermes already keeps that profile's skills, soul, sessions, tool steps and token use. gtmworks also kept its own copy of each, so every one was built, tested and fixed twice.

## Decision

The Engine is the only store of these. gtmworks reads and writes them through the management listener (ADR 0011, ADR 0016) and keeps no copy:

- **Skills:** these live in the Agent's profile and in the Company's shared skills folder (`cs-<company id>`). The skills screen lists and writes them there (#343). Lesson approval stays in gtmworks and writes the shared skill `team-lessons`.
- **Company knowledge:** this is the shared skill `company-knowledge`, beside `team-lessons` (#344). Who may edit it, and the log of edits, stay in gtmworks. No Run carries it.
- **Agent rules:** these are written into a gtmworks-owned section of the Agent's profile `SOUL.md` (#345). The soul is always loaded and has no memory budget. Text outside the section is never changed. Who may give rules, the rule record (`agent_rules`) and the rule log stay in gtmworks. No Run carries them.
- **Run steps and token use:** these are read live from the Hermes session when a chat opens and when the usage screen loads (#346, #347). A deleted profile takes its old steps and usage with it (Omar accepted this).
- **One Hermes:** the bundled Hermes is the only Hermes (#342). "Connect a Hermes you already have", its connections and its driver are removed. Every Run goes through the Company's own profile.
- **The external-agent API:** agent keys, run keys, webhooks and their deliveries, rate limits, refusals, Engine tool checks, the `v1` routes and the webhook worker are removed (#341).

gtmworks keeps only what the Engine does not have:

- people, roles, invitations and sign-in;
- Company separation (RLS on `company_id`, ADR 0004);
- team spaces, the marketing board, approvals and the audit log;
- team files and per-person notes;
- the chat record (`conversation_messages`) and the queued turns (`conversation_queued_turns`). Hermes's busy queue is one per session, so gtmworks could not show who waits with what.

### Kept on purpose: do not drop these by name

Some tables share a name with what was removed but serve features that stay:

- **`agent_requests`:** stops two clicks on the board's «ask an Agent» from making two cards (`agent_write`). It is not the external-agent API's request log.
- **`agent_key_waits`:** holds a new Agent until the Company's model provider key is set (#299). It is about provider keys, not agent keys.
- **`agent_rules`:** the governed record of who gave which rule and its approval. The Engine's copy is the `SOUL.md` section written from it.
- **`conversation_run_ends`:** formerly `conversation_usage`, now without its token columns. It records how each Run ended (lost, stopped, failed), which shows "did not finish" in the chat and closes a Run's open questions and permission requests.

### Migrations

Old data is not copied into the Engine, and the old tables, functions, policies and grants are dropped in the same spec (decision 0042). An upgraded install rolled back to v0.1.0 finds them missing (Omar accepted this).

## Consequences

- No ticket adds a gtmworks table for something the Engine keeps. A new need for skills, soul, steps or usage is met through the management listener.
- Opening a chat reads the Hermes session. It must stay under 1 second; #346 measured 238 ms in the seeded stack.
- Steps are matched to replies by time. This is safe because the bundled Hermes runs on the same machine as the database.
