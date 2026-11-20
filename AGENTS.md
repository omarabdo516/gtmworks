# gtmworks

An open-source, self-hosted marketing operating system: people direct, approve and read results. Agents get Hermes's full power first, publishing and spending included when a Member asks, and a limit is added only after a real problem Omar names (ADR 0020); agents never approve a Version. Hermes ships inside the install and is the engine behind one engine contract (ADR 0009, 0010); gtmworks writes no model loop itself.
English-first UI with a complete Egyptian Arabic translation worded as in the approved reference (`design-reference/`): every new interface string goes in both message catalogues, direction follows the chosen language, content keeps its own.

## How work is done

Work arrives as a spec issue with its tickets as sub-issues; one thread runs `/implement-spec` on branch `spec/<slug>`. The spec's one pull request closes the spec and every ticket it built, one `Closes #<n>` per line; a ticket left unbuilt is named in the body and stays open. The spec and its tickets are the scope: open an issue for anything else you find. A change a person can see adds its entry to `lib/whats-new.json` in the same pull request: its issue, the merge date, and a bold title with one sentence in English and Egyptian Arabic, newest first; it is what an Owner reads in Update ready and What's new (#442). CodeRabbit and the `code-review` skill review the pull request; every review thread is fixed or answered.

Architecture (Omar, 2026-11-19): a design choice is judged by whether it is the right shape for the product, not the quickest fix. A wrong old shape inside the spec's scope is replaced, never patched over; outside the scope, open an issue.

Every build uses Matt Pocock's engineering skills (configured in `docs/agents/`, see the Agent skills section of `CLAUDE.md`) with Ponytail.

Merge: every pull request merges itself by GitHub auto-merge (you arm it: `gh pr merge <n> --auto --squash`, once the PR is ready and CodeRabbit has posted) when its required check `check` is green and every review thread is fixed or answered and resolved (Omar, 2026-11-15). Never merge directly, bypass the ruleset, or weaken a test to go green.

Money, secrets, release tags and repo settings stay with Omar: write an `ASK-HERMES:` line and carry on with the rest of the work.
Deleting code or files inside your pull request or your own worktree is normal work: git keeps it and the PR can be reverted. Ask Omar first (an `ASK-HERMES:` line) only before deleting what git cannot bring back: production database data, files outside the repo, branches, tags, releases or cloud resources (Omar, 2026-11-19).

## Tests

`./ci.sh check` runs everything CI runs; `./ci.sh fast` is the quick loop (static checks, node tests, component tests).
`./ci.sh install` runs the CI install job (`scripts/ci-install-check.sh`) on an isolated Docker machine here; it runs `HEAD`, so commit first.

## Read when

- Naming anything: `GLOSSARY.md` (the product's words; «براند» in Omar's words is a **Company** here) and `docs/adr/` (decisions that bind the code).
- Building a screen: `DESIGN.md`, `design/` and the approved prototype named in the issue; every screen matches them. A UI change with no approved look names its approved prototype in the issue. `PRODUCT.md` holds the product record.
- Touching tests, CI, the `check` job or `ci.sh`: `docs/agents/checks.md` (CI layout and lanes; `docs/testing.md` lists the tests).
- Changing a screen the visual lane covers or its baseline images: `docs/agents/visual-comparison.md`.
- Reviewing a pull request (yours or another's): `docs/agents/code-review-rules.md`.
