# Database default privileges

Local migrations start with the broad hosted Supabase privilege profile. This
keeps migration tests sensitive to the accidental access reproduced in #96.
`scripts/local-default-privileges.sql` is copied before application migrations by
`scripts/local-db.sh`; it is never sent to cloud by the deployment script.

For objects created by `postgres` in `public`, each of `anon`, `authenticated`
and `service_role` receives:

| Object | Default privileges |
| --- | --- |
| Table or view | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN |
| Sequence | USAGE, SELECT, UPDATE |
| Function | EXECUTE, directly and also through PostgreSQL's global PUBLIC default |

This is a specified test profile, not a measurement of the deployed project.
Supabase's [Securing your API: default privileges](https://supabase.com/docs/guides/api/securing-your-api#default-privileges)
lists these grants, including MAINTAIN for PostgreSQL 17. Its
[check procedure](https://supabase.com/docs/guides/api/securing-your-api#check-your-default-privileges)
explains that actual defaults depend on project age and Data API settings.
The [platform changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
announces an explicit-grant rollout through October 30, 2026. The API guide also
notes that disabling automatic API exposure can retain non-API privileges such
as TRUNCATE and sequence UPDATE. A blanket claim that every hosted project has
the same defaults would therefore be incorrect. These official sources were
consulted on November 8, 2026; no hosted credentials or database were accessed.

PostgreSQL's [ALTER DEFAULT PRIVILEGES reference](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
establishes that TABLES includes views, defaults follow the object-creating role,
and a schema-level revoke cannot remove a global grant. The
`20261114000000_require_explicit_object_grants.sql` forward migration therefore
revokes automatic table, sequence and function grants to the three API roles,
and revokes global PUBLIC EXECUTE for future functions. Existing grants and
policies are preserved. Migration authors must grant only the access a new
object needs, enable RLS on tables, and use `security_invoker=true` for views
that expose rows governed by RLS.

`npm run test:db` exercises two boundaries in rolled-back local transactions:

- `tests/hosted-default-privileges.mjs` removes image-provided client defaults,
  applies the actual local bootstrap and lists/checks the full matrix on newly
  created objects. Its function check revokes PUBLIC to prove the direct grants.
- `supabase/tests/default_privileges.sql` checks migrated tables by name for
  missing RLS, then creates new objects and tries them as `anon` and
  `authenticated`. Explicit grants allow the intended operations while RLS
  continues to hide other companies' rows, including through an invoker view.

The existing invitation regression test reinstalls the broad defaults within
its transaction before recreating the legacy function, so #96 remains tested
even after future objects require explicit grants.
