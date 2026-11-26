# Code Review Rules

## The issue is the contract
- The PR matches its spec and tickets: flag an acceptance item with no code or test in the diff, and code that goes beyond the spec.

## Existing tests keep their meaning
- Flag an existing test that is deleted, skipped or loosened so it no longer proves what it proved, and a refreshed screenshot baseline with no matching screen change in the diff.
  Safe path: new tests, or a baseline refresh for screens the issue changes.

## Company isolation and roles
- Company data is reached only through the caller's own company (ADR 0004), and Administrator-only actions are checked on the server. Flag a `service_role` query with no owner or company filter, and a permission check that exists only in the browser.

## Keys and secrets
- An Engine's key comes only from its Company's Engine record (or, for unit tests with no database, the server's environment), never from `.env.install`, and a Company's model provider keys are kept in the Engine; none is returned to the browser or logged (ADR 0017, ADR 0018). Flag request bodies, headers or exception text written to logs on a route that receives a key, and any Engine key or address put back in the app's or the worker's environment.

## Database changes
- `install.sh update` applies migrations by itself, before the new app version starts. Flag a migration that drops or rewrites existing data when the issue does not say so, and one the previous app version cannot run against. A change the previous version cannot run against is two migrations (ADR 0023): a first step that only adds, and a `*_cutover.sql` that removes, which `install.sh` applies only once the new app answers; flag a cutover without its first step, and a first step that takes something away.
