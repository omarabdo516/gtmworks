# Threat model

What a reviewer should protect in gtmworks, read from the code and the ADRs. Every claim names its source; a control that is planned and not built is marked "planned".

## Entry points and who can call them

- **Browser sessions.** People sign in with Supabase Auth; `middleware.ts` refreshes the session on every route except `/api/health`, `/api/config`, `/api/client-errors` and static files (its `matcher`). Pages and server actions query with the person's session and the anon key, so RLS applies (`lib/supabase.ts`, ADR 0004). Company pages live at `/c/<slug>/...` (ADR 0004).
- **Public, anonymous routes.** `/api/health` (health only), `/api/config` (the public Supabase URL and anon key), `/api/client-errors` (browser errors written to the log, redacted, at most 60 lines a minute: `lib/diagnostics.mjs` `redact`, `limiter`). `POST /first-run/submit` creates the first owner and company with the service key, only while `setup_is_open()` is true (`app/first-run/submit/route.ts`, `supabase/migrations/20261126000000_first_run.sql`).
- **Session API routes.** `/api/hermes-connections`, `/api/hermes-agents` and `/api/recent-cards` require a signed-in user (`auth.getUser()`); the two Hermes routes refuse a POST that is not JSON or whose `Origin` host differs from `Host`.
- **`/api/v1` agent API.** `app/api/v1/companies/[slug]/[...path]/route.ts` accepts `Bearer gtmw_agt_…`, `gtmw_run_…` or legacy `agt_…` keys (line 9) and answers 404 for another company's slug (line 30). `lib/agent-auth.ts` looks the key up by SHA-256 hash with the service key, applies `agent_rate_limit`, then mints a 5-minute member JWT so every card query runs under RLS as that agent (line 35, ADR 0006). Contract: `docs/api/openapi.yaml`.
- **Webhooks (outbound only).** No route receives a webhook. The worker (`worker/index.mjs`, `worker/webhooks.mjs`) posts signed events (`X-GTMWorks-Signature`, HMAC-SHA256) to a company's webhook URL with `redirect:'error'`, and puts a fresh run key in an `assigned` event only over HTTPS or to localhost (`worker/webhooks.mjs` line 18, ADR 0007).
- **The Hermes connection (outbound only).** gtmworks calls Hermes; Hermes does not call gtmworks. All calls are in `lib/hermes.mjs` (ADR 0008): bearer key, `redirect:'manual'`, 5 s timeout, and plain HTTP only to loopback, private, CGNAT and `.local`/`.internal`/`.ts.net` hosts (`isHermesAddressAllowed`).

## Trust boundaries

- **Company owners and members.** `is_member(company)` gates reads on every company table; writes follow the member's role (`can_manage_company`, `work_can_edit`, ADR 0004). A company the person is not a member of reads as nothing. No Agency bypass and no two-step requirement exist (ADR 0012, `supabase/migrations/20261204000000_remove_agency.sql`).
- **Company owners only.** `is_company_owner(company)` (an active Owner member) gates Hermes Connections, managing the Company's agents, the `record_conversation_*` writes, the shared-Engine notice and usage (ADR 0012).
- **Agents.** An agent is a member with keys. A role agent's key resolves only while its company grant is active (`lookup_agent_key`, `agent_key_denied` in `20261115000000_agent_grants.sql`, ADR 0006). A run key reaches one card: the route refuses other paths (`route.ts` line 58), RPCs check the JWT's `run_card` (`20261116000000_run_keys.sql` line 84, `20261117000000_card_requests.sql` line 55), and attachments RLS checks it (`20261119000000_attachments.sql` line 22). Agents never approve, publish or spend (ADR 0006, ADR 0008).
- **The service role.** Bypasses RLS. Held only by: `lib/agent-auth.ts` (key lookup, rate limit), `lib/first-run.ts` (setup), `app/api/hermes-connections/route.ts` line 48 (reads one `key_encrypted` by `id`, after the caller is checked as an Owner of the company the Connection was read in), `app/c/[slug]/[[...section]]/actions.ts` line 22 (sends the invitation email after the RLS-checked invitation row) and the worker (`worker/webhooks.mjs`). Elevated functions are granted to `service_role` only (`lookup_agent_key`, `agent_rate_limit`, `claim_webhook_deliveries`, `issue_run_key_for`, `setup_is_open`, `complete_setup`).
- **Isolation tests.** `supabase/tests/foundation.sql` fails when a public table lacks RLS; `supabase/shared-tables.txt` lists the tables without a company column.

## Secrets and privileged actions

- **Settings.** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY` (`lib/settings.mjs`). Losing the encryption key loses every stored Hermes key and webhook secret (ADR 0008).
- **Agent and run keys.** Shown once, stored only as SHA-256 hashes (`lib/agent-crypto.mjs` `newKey`, `agent_keys.key_hash`, ADR 0007). Run keys expire (`issue_run_key_for`; the worker asks for 3600 s) and are revoked with the grant (`20261116000000_run_keys.sql`).
- **Hermes keys.** AES-256-GCM with `WEBHOOK_ENCRYPTION_KEY` (`lib/agent-crypto.mjs` `encryptSecret`). `authenticated` cannot select `key_encrypted`; only `service_role` can (column grants, `20261123000000_hermes_connections.sql` lines 22-26). Reading, saving, replacing and removing need `is_company_owner(company_id)`, and saving also `owner_id = auth.uid()` (policies `hermes_read`, `hermes_create`, `hermes_replace`, `hermes_remove`, `20261204000000_remove_agency.sql`). The route's catch logs a fixed message, not the error (`route.ts` line 63).
- **Webhook secrets.** Encrypted on save (`agent-actions.ts` line 29); the settings page reads only `url` (`page.tsx` line 46). Unlike `hermes_connections`, no migration limits which `agent_webhooks` columns an Owner's session may select (policy `agent_webhooks_owner`, `20261108000000_agents.sql` line 61).
- **Logs.** `lib/diagnostics.mjs` keeps only the company id and slug from a form and redacts secret settings, bearer tokens, long tokens and 6-8 digit codes. A new `console.*` call bypasses it.
- **Privileged actions.** First-run setup; inviting members (service key); connecting Hermes; issuing run keys; approving a version (a person only, ADR 0006).

## Look here first

1. **Every service-role call site** (the five listed above). A new one, or one without a filter on owner, company or id, skips RLS for everyone.
2. **Run-key scope in `/api/v1`.** Card reads for a run key rely on `route.ts` line 58 plus the `run_card` checks in RPCs and attachments RLS; `work_cards` RLS itself does not check `run_card`. A new path or RPC must keep both.
3. **Anything that receives or sends a key**: `/api/hermes-connections`, `lib/hermes.mjs`, `worker/webhooks.mjs`, `agent-actions.ts`. Look for a key, header, request body or remote error text in a log, a response or a stored error, and for a redirect followed with a key.

Planned, not built (never treat as enforced): fenced leases, heartbeats and a watchdog for runs (ADR 0006); conversations relayed from Hermes (#190, ADR 0008).
