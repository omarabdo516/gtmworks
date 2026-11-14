---
status: accepted
---

# No Agency layer: the Company's Owner manages the Company, and the reviewer Role is removed

Issue #7 (parent #1). This supersedes the Agency layer of [ADR 0004](0004-one-database-company-on-every-row-rls-and-worker-layer.md): the Agency bypass, the Agency list and the reviewer Role. The rest of ADR 0004 still holds. It also replaces the Agency owner of [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) and [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md) with the Company's Owner.

## Context

ADR 0004 let Agency staff (`people.agency_owner`, after app-based two-step verification) read every Company and edit its work without being a Member of it, and gave them a list of all Companies. Hermes Connections, the Company's agents, the `record_conversation_*` writes, the shared-Engine notice and usage were Agency-only. The Role list also had a reviewer.

gtmworks is open source, and each install belongs to the person who runs it. There is no agency behind an install, so nobody outside a Company's Members should enter it.

## Decision

- No policy or function grants access because a person is Agency staff. `agency_access()`, `is_agency_owner()` and `people.agency_owner` are removed, and so is the Agency list (`/all-brands`). Every Company table is read only by the Company's Members.
- What was Agency-only is done by the Company's Owner (an active Owner Member): Hermes Connections, managing the Company's agents, the `record_conversation_*` writes, the shared-Engine notice and usage. `is_company_owner(company)` is the one check these make.
- No two-step requirement. The two-step verification screen existed only to gate the Agency and is removed.
- `hermes_connections.agency_owner_id` is renamed `owner_id`: the Owner who made the Connection. Any Owner of the Company may read, replace or remove it.
- The first person through first-run becomes the Owner Member of the first Company. Only an Owner makes another Member an Owner.
- The Roles are Owner, Manager, Contributor and Viewer. Former reviewers, and invitations to the reviewer Role, become Contributors.
- Contributors never approve, so approvers are Owners and Managers. An approval step addressed to reviewers, or to one person who was a reviewer, is addressed to the Company's Managers.

Migration: `supabase/migrations/20261204000000_remove_agency.sql`.

## Consequences

- Omar has no see-all. He enters a Company only as one of its Members, like anyone else.
- An Owner of two Companies may share one Hermes profile between them, after the same memory-sharing warning as before.
- During an update, the previous app version's Agency screens and Agency-only calls refuse, because the database no longer grants them. Its other screens keep working until the new version starts.
- Former reviewers no longer approve; they hold what a Contributor holds. A card waiting at a former reviewer's step now waits for the Company's Managers.
- Old audit and activity rows are not rewritten, so their stored text may still say reviewer or Agency.
- Bringing back an agency that serves many installs would need a new ADR; it is not a flag to turn on.
