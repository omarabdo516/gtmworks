# gtmworks

An open-source, self-hosted marketing operating system. Conversations run on an agent engine through one engine contract (ADR 0009): Hermes ships inside the install and is the engine (ADR 0010), and gtmworks writes no model loop itself. Hermes owns agents, their settings, skills, scheduled work and memory; gtmworks owns companies, members, marketing cards, versions, approvals and the record of each conversation as people saw it. People direct, approve and read results; agents never approve, publish or spend (ADR 0006, 0008). RS Learning is the first Company in Omar's installation; R&S Consultations, Aleem and others follow on the same structure. English-first UI, with a complete shipped Arabic translation in Egyptian Arabic, worded as in the approved reference (`design-reference/`). Direction follows the chosen language; content keeps its own direction. Every new interface string belongs in both message catalogues.

## How work arrives

Work arrives as GitHub issues in this repo, each with an acceptance list; each issue carries what its work needs. It is built on a branch and opened as a pull request whose body starts with `Closes #<n>`. The required check is `check`, and the pull request is reviewed on GitHub before it merges. A UI change with no approved look names its approved prototype in the issue.

CodeRabbit comments are advisory. A builder fixes a comment that names a real defect against the issue.
The builder answers the rest in one line and never waits for CodeRabbit to merge.

## Before exploring, read these

- `GLOSSARY.md`: the product's words. «براند» in Omar's words is a **Company** here.
- `docs/adr/`: decisions that bind the code (stack, isolation, where AI runs).
- `DESIGN.md` and `design/` once the Look is approved: every screen is built to match them.

## Design workflow

Impeccable (the design skill) is this repo's design workflow, used in full: every one of its commands and its detector may be used (Omar, 2026-11-09). `PRODUCT.md` holds the confirmed product record; `DESIGN.md` holds the look. Both, and `.impeccable/config.json` (hook enabled), are committed; `.impeccable/config.local.json` and the runtime folders are git-ignored.

- UI work starts with the skill's `scripts/impeccable context` run from the repo, then follows the playbook for the task (its `reference/` file for the command, or `reference/new-work.md` for a new surface). A refinement of an existing screen keeps the Paperclip identity in `DESIGN.md`.
- A detector finding (from the hook or `impeccable detect`) is triaged as `reference/hooks.md` says:
  - A real design problem is fixed. Never add an ignore to push a change through.
  - A confident false positive gets the narrowest ignore, `impeccable hooks ignore-value <rule> <value> --reason "<who decided: evidence>"`, with the evidence named, and the ignore is disclosed in the PR.
  - `ignore-rule` and `ignore-file` silence too much: they need Omar's yes first.
  - Unsure: leave the finding standing and say why in one line.
- Hook settings change only through `impeccable hooks`, never by hand-editing the config files.

## Checks

`./ci.sh check` runs `./ci.sh static` then `./ci.sh integration`; CI also checks the Docker install.
For PRs and pushes to `main`, CI always runs static and skips integration and install only when every changed file is under `design/`, under `docs/`, or ends in `.md`, except files under `public/` (read by a browser test); unknown or empty diffs run all stages. A push to `main` is judged against the last commit a successful main CI run tested.

CI deploys nothing. An install picks up a merge when its owner runs `sh scripts/install.sh update` (README), which applies new migrations before the new app version starts; a failed migration rolls back and the previous app keeps serving. A later version does not undo an applied migration; recovery needs a new forward migration. A forward migration cannot bring back deleted data; restore it from a backup.

## Visual comparison

`tests/visual.spec.ts` compares sixteen screens with approved images, each in Arabic
and English at 390 and 1440 wide (64 images in `tests/visual.spec.ts-snapshots/`):
sign-in, first run, Home, the Conversation with the main Agent, the board, a card, the calendar, approvals, settings
members, agents and work, and sign-in, Home, the Conversation, the board and a card in the dark theme. The list lives in `tests/visual-screens.mjs`;
`tests/visual-baselines.test.mjs` fails when a screen lacks an image or an image has
no screen.

- The `visual` project runs first in `npm run test:e2e`, on the database exactly as
  the seed builds it, then the `functional` project runs, also when a screen failed,
  and the `first-run` project last (each is a Playwright teardown project, so it
  waits for the earlier ones without being skipped by their failures). One CI round
  reports every group and `check` is red when any fails. Run one file with
  `npx playwright test --project=functional tests/frame.spec.ts`; screens alone
  with `npm run test:visual` (`--no-deps` keeps the functional tests out).
- The page is stable by construction: reduced motion, animations and caret off,
  Playwright waits for two identical captures, the window grows until nothing
  scrolls, the seeded cards are pinned to fixed days in June 2026, the calendar
  opens on that month, and times and the 14 day chart labels are replaced by fixed
  text (their layout, font and colour are still compared).
- A failing comparison writes the expected, actual and difference images to
  `test-results/screenshots/visual/`, which CI uploads in the `route-screenshots`
  artifact.
- When a change intentionally alters a screen, refresh its approved images with
  `Visual baselines`. It runs `./ci.sh visual-update` on the same GitHub-hosted runner
  (`ubuntu-latest`) and Node version as CI, with a fresh database, and uploads only changed or new images.
  Start it on the PR branch, then download the artifact from that run:

  ```sh
  gh workflow run visual-baselines.yml --ref <branch>
  gh run download <run-id> -n visual-baselines -D tests/visual.spec.ts-snapshots/
  git add tests/visual.spec.ts-snapshots/ && git commit -m "Refresh approved screen images"
  ```

  If nothing changed, the list step prints nothing and no artifact is uploaded.
  Review the downloaded images and commit them in the same PR as the change that
  caused them. Images are named for Linux (`-linux`); never commit ones made on
  another system.

## Code Review Rules

### The issue is the contract
- The PR body starts with `Closes #<n>` and lists the issue's acceptance items. Flag an acceptance item with no code or test in the diff, and code that goes beyond the issue.

### Existing tests keep their meaning
- Flag an existing test that is deleted, skipped or loosened so it no longer proves what it proved, and a refreshed screenshot baseline with no matching screen change in the diff.
  Safe path: new tests, or a baseline refresh for screens the issue changes.

### Company isolation and roles
- Company data is reached only through the caller's own company (ADR 0004), and Owner-only actions are checked on the server. Flag a `service_role` query with no owner or company filter, and a permission check that exists only in the browser.

### Keys and secrets
- Hermes keys and webhook secrets are stored encrypted, agent and run keys only as hashes; none is returned after saving or logged (ADR 0007, ADR 0008). Flag request bodies, headers or exception text written to logs on a route that receives a key.

### Database changes
- `install.sh update` applies migrations by itself, before the new app version starts. Flag a migration that drops or rewrites existing data when the issue does not say so, and one the previous app version cannot run against.
