# gtmworks

An open-source, self-hosted marketing operating system whose aim is marketing run by Agents end to end; people direct them, teach them and read results. gtmworks is an interface and a gatekeeper over Hermes: Hermes keeps what Agents do, and gtmworks stores only what is about people (ADR 0033). New work follows that rule; code built before it keeps its shape until its spec lands. Agents get Hermes's full power first, publishing and spending included when a Member asks, and a limit is added only after a real problem Omar names (ADR 0020). Hermes ships inside the install (ADR 0010); gtmworks writes no model loop itself.
English-first UI with a complete Egyptian Arabic translation worded as in the approved reference (`design-reference/`): every new interface string goes in both message catalogues, direction follows the chosen language, content keeps its own.

## How work is done

Work arrives as a spec issue with its tickets as sub-issues; one thread runs `/implement-spec` on branch `spec/<slug>`. The spec's one pull request closes the spec and every ticket it built, one `Closes #<n>` per line; a ticket left unbuilt is named in the body and stays open. The spec and its tickets are the scope: open an issue for anything else you find. A change a person can see adds its entry to `lib/whats-new.json` in the same pull request: its issue, the merge date, and a bold title with one sentence in English and Egyptian Arabic, newest first; it is what an Owner reads in Update ready and What's new (#442). A change that builds a line of `ROADMAP.md` marks it ✅ in the same pull request, and its line in the README's Roadmap list if it has one; a feature found on the way goes in as ⚪. CodeRabbit and the `code-review` skill review the pull request; every review thread is fixed or answered.

Architecture (Omar, 2026-11-19): a design choice is judged by whether it is the right shape for the product, not the quickest fix. A wrong old shape inside the spec's scope is replaced, never patched over; outside the scope, open an issue.

Every build uses Matt Pocock's engineering skills (configured in `docs/agents/`, see the Agent skills section of `CLAUDE.md`) with Ponytail.

Merge: every pull request merges itself by GitHub auto-merge (you arm it: `gh pr merge <n> --auto --squash`, once the PR is ready and CodeRabbit has posted) when its required check `check` is green and every review thread is fixed or answered and resolved (Omar, 2026-11-15). If GitHub refuses to arm it because the pull request is already in clean status (every requirement met), merge it yourself, squash, never `--admin`, and only after you read `mergeStateStatus` `CLEAN` (or `mergeable_state` `clean` over REST) yourself; `gh` does not enforce it: `gh pr merge <n> --squash`, or in a cloud session, where `gh` cannot reach GraphQL, the GitHub MCP merge tool with the head SHA pinned. A green pull request left waiting stalls everything behind it. Never bypass the ruleset or weaken a test to go green.

Money, secrets, release tags and repo settings stay with Omar: write an `ASK-HERMES:` line and carry on with the rest of the work.
Deleting code or files inside your pull request or your own worktree is normal work: git keeps it and the PR can be reverted. Ask Omar first (an `ASK-HERMES:` line) only before deleting what git cannot bring back: production database data, files outside the repo, branches, tags, releases or cloud resources (Omar, 2026-11-19).

## Tests

`./ci.sh check` runs everything CI runs; `./ci.sh fast` is the quick loop (static checks, node tests, component tests).
`./ci.sh install` runs the CI install job (`scripts/ci-install-check.sh`) on an isolated Docker machine here; it runs `HEAD`, so commit first.
In a cloud session, before every push, bring the app up with `npm run cloud:up`, walk `npm run cloud:verify`, and use your change as a person would: `docs/agents/cloud-verify.md`, which also says how the image and integration jobs run there (`scripts/docker-build.sh`).

## Read when

- Naming anything: `GLOSSARY.md` (the product's words; «براند» in Omar's words is a **Company** here) and `docs/adr/` (decisions that bind the code).
- Building a screen: `DESIGN.md`, `design/` and the approved prototype named in the issue; every screen matches them. A UI change with no approved look names its approved prototype in the issue. `PRODUCT.md` holds the product record.
- Learning what a table, policy, function or grant is today: `supabase/schema.sql`, generated from a freshly migrated database by `node scripts/schema-snapshot.mjs write` and checked by the database job; never edit it by hand (#780).
- Touching tests, CI, the `check` job or `ci.sh`: `docs/agents/checks.md` (CI layout and lanes; `docs/testing.md` lists the tests).
- Reviewing a pull request (yours or another's): `docs/agents/code-review-rules.md`.

## Cloud sessions

A cloud session starts with only `/implement issue #<n>: <title>`, so these rules live here (Omar, 2026-11-26):

- Use only local or test credentials: no production keys, every email to `delivered@resend.dev`, Paymob in test mode.
- In a cloud session `gh pr` and `gh issue` fail (the proxy blocks GraphQL): use `gh api repos/...` REST calls or the GitHub MCP tools.
- Open one PR whose body says `Closes #<n>`, and follow its CI and review activity until it merges.
- Nobody reads the session chat: a decision only Omar can make goes as one short comment on the issue.
