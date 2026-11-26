---
status: accepted
date: 2026-11-26
---

# Agents are the Company's own Agents and nothing else

Spec #695 (decision 0067, point 17, Omar). It supersedes [ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md) where that ADR makes the four role agents shared identities with company grants. ADR 0006's other rules were already replaced: its runtime by [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) and [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md), its run keys and API by #341, and "an Agent never approves" by [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md) and [ADR 0033](0033-an-interface-and-a-gatekeeper-over-hermes.md).

## Context

- Before Agents were Engine profiles, a Company had four role agents: Account manager, Writer, Designer and Critic. Each was one identity shared by every Company (`public.agents`), working in a Company only while it held that Company's grant (`public.agent_grants`), and a Contributor membership carried its role key (`members.agent_role`).
- Since #341 nothing runs them, a fresh install makes none, and on Omar's install the tables were empty (read 2026-11-24). Their page, their tables, their grants and the role key stayed.
- The role key was given by an old name match (20261110000000) and by an Owner on the Members page. A person who held it by mistake was logged as an Agent and left out of mentions and channels.

## Decision

1. **An Agent is one of the Company's own Agents** (GLOSSARY: Agent), an Engine profile. There is no role agent, no company grant and no agent role key.
2. **The install's own rows decide who was a person.** An identity that ever signed in is a person: it keeps every membership and loses the key. One that never signed in was an old agent: its memberships are marked removed and it can no longer sign in; its `people` row stays, so what it wrote keeps its name. An identity recorded as a shared agent that also signed in cannot be told: the update stops with its name and drops nothing.
3. **History stays as it was written.** Old Company log rows keep the actor kind and name they were stored with; the members' change log keeps the role keys and the grant rows it stored, shown as plain text.
4. **Two steps** ([ADR 0023](0023-a-change-the-previous-release-cannot-run-against-is-staged.md)). `20270418000000_legacy_role_agents.sql` settles the rows and takes the role-agent branch out of mentions, channels, a Conversation's addressee and the log's actor kind; a new Card's request goes to one of the Company's Agents. `20270418000001_legacy_role_agents_cutover.sql` settles again, refuses while a role agent's row belongs to a person, and drops the tables, the key, its type and their functions.
5. **Kept:** `agent_requests` and `agent_write`, the Agents' own write path that today's Agents use.

## Consequences

- One kind of Agent in every menu, picker, filter and count. Nobody can make a person an agent.
- A Card once assigned to a role agent keeps that assignee's name, read from the removed membership's `people` row; no face or role marks it.
- A backup from before the cutover restores onto a release that has it: the install applies the cutover again after a restore, and it settles what the backup brought back.
