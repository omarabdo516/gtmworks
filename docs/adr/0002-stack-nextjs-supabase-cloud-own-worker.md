---
status: accepted
---

# Next.js on our own server, Supabase cloud for data, a separate worker for AI runs

Update ([ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md)): AI executes in external agent runtimes; the product worker handles non-AI delivery and scheduling. Agent identities, company grants and run records use the same Supabase database, with company_id on company-owned rows. The hosting stack below remains; where AI runs today is decided in [ADR 0008](0008-gtmworks-connects-to-hermes-with-encrypted-profile-keys.md) and [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md).

gtmworks starts on Next.js and TypeScript, with Supabase cloud (Pro plan) for the database, sign-in and file storage, and a background worker that runs apart from the web process and takes its jobs from a queue inside Postgres. The web app and the worker run in Docker on a server we control, not on a serverless platform, because the worker runs long background jobs. Omar chose this on 2026-10-05.

## Where it runs

- **Target:** a server of its own (a small VPS), holding nothing but this product.
- **For now:** a shared server that also runs other internal tools and bots. Omar accepted this as temporary.
- **Why the target matters:** the product's keys should sit on a machine nobody else's software can reach; today's design for AI runs and their keys is in ADR 0008 and ADR 0010.
- **What keeps the move cheap:** the app keeps nothing on the server's disk. Files go to Supabase Storage, data to Supabase, and settings to environment variables, so moving to another server is a redeploy. (An earlier internal tool read and wrote its data on disk; this product does not repeat that.)

## Considered Options

- **Self-hosted Postgres on the server.** Free, but backups, upgrades and security fall on us, and the server's only backup is weekly. Rejected for Supabase Pro at about $25 a month (read from supabase.com/pricing, 2026-10-05): daily backups kept 7 days, 8 GB database, 100 GB file storage, row-level security, sign-in.
- **A serverless host for the web (Vercel or similar).** Rejected: the worker needs long-running processes, so a server is needed anyway, and one server is simpler than two platforms.
- **Crons inside the web process, as in an earlier internal tool.** Rejected: a deploy kills a monthly strategy run halfway.
- **A Redis-based queue.** Rejected for now: under 50 companies in year one, a queue in the same Postgres needs no extra service.
- **Carrying over an earlier internal tool's home-made sign-in (bcrypt plus a signed cookie).** Rejected for Supabase Auth: password reset, invitations and sessions come ready.

## Consequences

- **Stack:**
  - Next.js and TypeScript for the web.
  - Supabase cloud (Pro) for Postgres, sign-in and Storage.
  - A separate worker process on the same server for AI runs and scheduled pulls (Meta, Google Ads, Odoo).
  - A Postgres-backed job queue.
  - Docker behind Caddy.
- **Supabase is now a vendor of record.** Leaving it means moving the database, sign-in and files together.
- **Still open:**
  - When the product moves to its own server: an item on the map.
  - How company data is kept apart inside the shared database: decided in [ADR 0004](0004-one-database-company-on-every-row-rls-and-worker-layer.md).
