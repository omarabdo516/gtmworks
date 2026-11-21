---
status: accepted
date: 2026-11-21
---

# A change the previous release cannot run against is staged

Hermes's decision for Omar of 2026-11-21, on review comment 4650678174 of PR #412 (spec #389). It does not change [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md)'s product decision that Agent levels are removed with their stored setting. It decides how that removal reaches an install that already runs.

## Context

An update applies every new migration before the new app starts (`scripts/install.sh`): the sandbox image is pulled, the migrations run, a source install builds its app, every Engine and work sandbox starts, and only then are the app and the worker replaced. The release being replaced serves through all of that, and stays serving when any of it fails. The code review rules already require that a migration stays usable by the previous app version.

Removing Agent levels drops columns and function signatures that the previous release's app and worker call (#391). Applied as one migration, it left that release failing its Conversations and profile records for the minutes every Engine and sandbox took to start, and for good when one of them did not start.

## Decision

A change the previous release cannot run against is made in two steps.

1. **The first step only adds**, and is an ordinary migration. Whatever the previous release calls keeps its columns, signatures and meaning. A function whose arguments change gets this release's overload beside the old one. Where one function must serve both releases, it takes both argument sets, and a call keeps its own release's meaning by the arguments it names. `tests/staged-migrations.test.mjs` fails when a migration before a cutover takes a column, a table or a function's arguments away.
2. **The second step is the cutover**, a migration whose name ends in `_cutover.sql`, sorted after the migrations it follows. `install.sh` leaves it out of the migrations it applies before the app starts. It applies it alone once the new app and worker answer their health checks, and again after a restore. It removes what the first step kept, and the final functions read only the new state.
3. **An update whose Engines or sandboxes do not all start goes back.** `install.sh` keeps the previous release's Engine files when an update begins. If an Engine or a work sandbox then does not start, it puts those files back and starts every Engine from them, without the containers the new template added. The previous release's app and worker were never replaced, so it keeps serving on the first step's schema. A build that fails stops before any container changes, with the same result.

For the Agent levels: `20270408100000_one_set_of_tools.sql` adds the confirmation that replaces the level, its writers, the health list with the sub-agents switch, and one `lead_create_agent` for both releases. `20270416000000_one_set_of_tools_cutover.sql` removes the level, its policy and the previous release's functions, and makes every reader use the confirmation. Between the two steps, legacy values decide nothing about the fixed set of tools the new worker writes. The previous release's level route keeps working until the new app replaces it, and no level control comes back.

## Consequences

- Each such change carries two migrations and states in the first which old contract it keeps, until the cutover.
- Between the new app starting and the cutover, the new app runs on the first step's schema. Its worker records the fixed set with its own functions, and the old readers decide whether a Run starts until the cutover replaces them. The window is the few seconds of the health checks.
- A cutover that fails leaves the new release serving; the install command applies it again.
- The install job proves it against the real previous release (`./ci.sh install staged-update`). Updates whose sandbox, or whose Engine, does not start leave that release serving, with its own Engines, its worker's profile records and its app's Conversation. The update that succeeds then removes the level, keeps its history and confirms the fixed tools.
