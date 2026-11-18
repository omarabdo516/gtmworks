# Threat model

What a reviewer should protect in gtmworks, read from the code and the ADRs. Every claim names its source; a control that is planned and not built is marked "planned".

## Entry points and who can call them

- **Browser sessions.** People sign in with Supabase Auth; `middleware.ts` refreshes the session on every route except `/api/health`, `/api/config`, `/api/client-errors` and static files (its `matcher`). Pages and server actions query with the person's session and the anon key, so RLS applies (`lib/supabase.ts`, ADR 0004). Company pages live at `/c/<slug>/...` (ADR 0004).
- **Public, anonymous routes.** `/api/health` (health only), `/api/config` (the public Supabase URL and anon key), `/api/client-errors` (browser errors written to the log, redacted, at most 60 lines a minute: `lib/diagnostics.mjs` `redact`, `limiter`). `POST /first-run/submit` creates the first owner and company with the service key, only while `setup_is_open()` is true and only with the one-time setup code the installer prints in its setup link (`SETUP_CODE` in `.env.install`, 256 bits, compared in constant time: `lib/setup-code.mjs`; the link carries it after `#`, so it reaches the server only in the submit body: `lib/setup-link.mjs`) (`app/first-run/submit/route.ts`, `supabase/migrations/20261126000000_first_run.sql`).
- **Session API routes.** `/api/hermes-agents` and `/api/recent-cards` require a signed-in user (`auth.getUser()`); the Hermes route refuses a POST that is not JSON or whose `Origin` host differs from `Host`. The pasted-Hermes route `/api/hermes-connections` is gone (#342) and answers 404.
- **The Hermes connection (outbound only).** gtmworks calls the bundled Hermes, the only Hermes (ADR 0017, #342); Hermes does not call gtmworks. The app and the worker take its address and key from the install's environment (`BUNDLED_HERMES_URL`, `HERMES_API_KEY`, `lib/bundled-hermes.mjs`); no row stores either. All calls are in `lib/hermes.mjs` (ADR 0008): bearer key, `redirect:'manual'`, 5 s timeout, and plain HTTP only to loopback, private, CGNAT and `.local`/`.internal`/`.ts.net` hosts (`isHermesAddressAllowed`).

## Trust boundaries

- **Company owners and members.** `is_member(company)` gates reads on every company table; writes follow the member's role (`can_manage_company`, `work_can_edit`, ADR 0004). A company the person is not a member of reads as nothing. No Agency bypass and no two-step requirement exist (ADR 0012, `supabase/migrations/20261204000000_remove_agency.sql`).
- **Company owners only.** `is_company_owner(company)` (an active Owner member) gates managing the Company's agents, the `record_conversation_*` writes, the shared-Engine notice and usage (ADR 0012).
- **Agents.** An agent is a member of its company; a role agent is a member only while its company grant is active (`agent_membership_guard`, `20261115000000_agent_grants.sql`, ADR 0006). There are no agent or run keys and no `/api/v1` API: both were removed with the external-agent API (#341, `20270206000000_remove_external_agent_api.sql`), and the old routes answer 404.
- **The service role.** Bypasses RLS. Held only by: `lib/first-run.ts` (setup), `app/c/[slug]/[[...section]]/actions.ts` line 22 (sends the invitation email after the RLS-checked invitation row) and the worker (`worker/webhooks.mjs`). Elevated functions are granted to `service_role` only (`lookup_agent_key`, `agent_rate_limit`, `claim_webhook_deliveries`, `issue_run_key_for`, `setup_is_open`, `complete_setup`).
- **Isolation tests.** `supabase/tests/foundation.sql` fails when a public table lacks RLS; `supabase/shared-tables.txt` lists the tables without a company column. The install job proves Company isolation on the pinned Engine (#126): two Companies with a main Agent and a second Agent each, every Agent on its own profile and every Company on its one shared space; terminal, file and code tools off in every Agent profile's config and absent from its Run API; a Run on a shared space refused; a memory written in one Company's main Agent reaching that Agent's Run only; a Skill in one Company's shared folder listed for its two Agents and for neither of the other Company's; a key set for one Company set in its own profiles and never in the other's or the root; and the database refusing a `hermes_agents` row of one Company that names the other's profile. `scripts/check-install-profiles.mjs` prints names and states only (`lib/install-proof.mjs`), and `scripts/check-hermes-keys.py` scans every profile, the capacity ones included.

## Secrets and privileged actions

- **Settings.** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY` (`lib/settings.mjs`), and the bundled Hermes's `HERMES_API_KEY` (`.env.install`).
- **Hermes key.** The install-generated `HERMES_API_KEY` stays in the install's environment and is handed only to the driver (`lib/hermes.mjs`); since #342 no Hermes key is stored in the database (the encrypted Connection keys went with `hermes_connections`). No route returns it and no log line names it.
- **Logs.** `lib/diagnostics.mjs` keeps only the company id and slug from a form and redacts secret settings, bearer tokens, long tokens and 6-8 digit codes. A new `console.*` call bypasses it.
- **Privileged actions.** First-run setup; inviting members (service key); approving a version (a person only, ADR 0006).

## Look here first

1. **Every service-role call site** (the five listed above). A new one, or one without a filter on owner, company or id, skips RLS for everyone.
2. **Anything that receives or sends a key**: `lib/hermes.mjs`, `lib/bundled-hermes.mjs`, the provider-key route. Look for a key, header, request body or remote error text in a log, a response or a stored error, and for a redirect followed with a key.

Planned, not built (never treat as enforced): fenced leases, heartbeats and a watchdog for runs (ADR 0006); conversations relayed from Hermes (#190, ADR 0008).
