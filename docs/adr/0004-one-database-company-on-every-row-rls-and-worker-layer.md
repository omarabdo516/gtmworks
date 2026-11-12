---
status: accepted
---

# One database for every company, a company on every row, enforced by database policies and the worker's data layer

Update ([ADR 0006](0006-agent-identities-company-grants-and-card-scoped-runs.md)): shared agent identities belong in this database; planned company grants, run records and their audits will carry company_id. RLS and checked RPCs must enforce company and card/run authority when these ship. The API authentication module also holds the service key solely for key lookup and rate accounting; current card queries use member-scoped JWTs, never that key.

All companies share one Supabase project and one schema. Every company-owned row, file path, embedding, job and log carries its company. Isolation is enforced twice:

- **Database policies:** row-level security on every table, default deny. A person reads only the companies they are a member of, and writes only what their role in that company permits.
- **The worker's data layer:** the only code that holds the service key. Every function and every job requires a company.

Omar chose this on 2026-10-05.

## Considered Options

- **A Supabase project per company.** Rejected on cost: about $515 a month at 50 companies, against $25 for one project. That is the $25 Pro plan plus at least $10 compute for each extra project (read from supabase.com/pricing, 2026-10-05). Also rejected on sign-in: Supabase Auth is per project, so an agency member serving RS and Aleem would need one login per company. That breaks the settled rule that one person is a member of many companies.
- **A Postgres schema per company.** Rejected: one migration has to run 50 times, Supabase Auth and Storage stay shared anyway, and RLS gives the same separation for under 50 companies.
- **App-code checks only, as an earlier internal tool did** (its dashboard used the service key, which bypasses RLS; reviewed 2026-10-05). Rejected: one forgotten `where` leaks a company.

## Consequences

- **Web queries never use the service key.** They run with the signed-in person's session, so RLS applies to every one of them.
- **The active company comes from the URL** (`/c/<company-slug>/...`). A company the person is not a member of answers 404.
- **Write permissions are data, not code.** They are read from each company's own role-permission settings, so a company can change them without a deploy.
- **Shared Storage and pgvector inherit the same rule:**
  - Storage paths start with the company id, and Storage policies check it.
  - Similarity search requires a company before it ranks anything.
- **A CI test fails when a table lacks RLS or a company column,** outside a short allowlist of shared tables.
- **Omar's see-all is a flag honoured only after app-based 2FA,** and his actions inside a company are logged under his name.
- **Leaving this model later means splitting one database into many,** which is why it is recorded here.
