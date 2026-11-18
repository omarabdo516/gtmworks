# gtmworks

An open-source, self-hosted marketing operating system. Conversations run on an agent engine through one engine contract (ADR 0009): Hermes ships inside the install and is the engine (ADR 0010), and gtmworks writes no model loop itself. Hermes owns agents, their settings, skills, scheduled work and memory; gtmworks owns companies, members, marketing cards, versions, approvals and the record of each conversation as people saw it. People direct, approve and read results; agents never approve, publish or spend (ADR 0006, 0008). RS Learning is the first Company in Omar's installation; R&S Consultations, Aleem and others follow on the same structure. English-first UI, with a complete shipped Arabic translation in Egyptian Arabic, worded as in the approved reference (`design-reference/`). Direction follows the chosen language; content keeps its own direction. Every new interface string belongs in both message catalogues.

## How work is done

Work arrives as a GitHub issue in this repo with an acceptance list. A UI change with no approved look names its approved prototype in the issue. The pull request body starts with `Closes #<n>`, the required check is `check`, and the pull request is reviewed on GitHub before it merges. CodeRabbit and Codex comments on GitHub are advisory.

Every build uses Matt Pocock's engineering skills (configured in `docs/agents/`, see the Agent skills section of `CLAUDE.md`) with Ponytail; the pstack trial ended on 17 Nov 2026. Money, secrets, deletion, release tags and repo settings stay with Omar: a build always pauses for them. Impeccable stays the design tool for screens (Design workflow below).

Every pull request merges itself. Once `check` is green on the head and every review thread is fixed or answered and resolved, the builder turns on GitHub auto-merge (`gh pr merge <n> --auto --squash`), and GitHub merges it. This is the standing request to merge, so no build stops at merge-ready waiting for a person. Never merge directly, bypass the ruleset, or weaken a test to go green.

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

`./ci.sh check` runs `./ci.sh fast` (the static checks, the node tests and the component tests at once; `./ci.sh static` leaves out the component tests), `./ci.sh database`, `./ci.sh visual` then `./ci.sh integration`; CI also checks the Docker install. In CI every job runs on a GitHub-hosted `ubuntu-latest` runner (decision 0038, #334); the visual lane and the measured navigation budgets run in their own `visual` job, where no other job shares the machine. They run on a push to `main` and on a manual run only, never on a pull request, and `check` does not wait for them; a failure on `main` opens or updates the `visual-regression` issue (Omar, 2026-11-17, #257). Design parity is checked once at delivery, outside CI (`docs/testing.md`).
In CI the first job decides what runs (`scripts/ci-areas.mjs`, as Hermes and T3 Code do, #76): the `fast` job runs on every change, its steps at once with each result listed in `check` (#258), and its screen component tests (Vitest in headless Chromium, one run) run when `app/`, `components/`, `lib/` or their tests change; the database tests, the whole-app browser suite (`integration`) and the install run on a pull request only when their own files change (`docs/testing.md` lists them); a change to the CI definition or `package.json` runs all; unknown or empty diffs run all. Screens alone run the fast job, its component tests included (#257). Screens are `app/` outside its `.ts` server code, `components/`, the catalogues in `lib/messages/`, and the visual lane's screens and images. A component test alone runs only the fast job. The journeys, the measured navigation, first run, the proxy suite and the image run when the journeys' own area changes: a browser spec or its helpers, the fake engines, the Playwright configs, server code under `app/` (its `.ts` route handlers and server actions), `lib/` outside the catalogues, `worker/`, the server and build files, the migrations, the seed, the image or `public/`. A push to `main` runs every suite unless every changed file is under `design/`, under `docs/`, or ends in `.md` (files under `public/` excepted), judged against the last commit a successful main CI run tested. A manual run starts the browser suite and the install only with `-f e2e=true` / `-f install=true`, off by default. `check` passes a suite nobody asked for only when it was skipped.

CI deploys nothing. An install picks up a merge when its owner runs `sh scripts/install.sh update` (README), which applies new migrations before the new app version starts; a failed migration rolls back and the previous app keeps serving. A later version does not undo an applied migration; recovery needs a new forward migration. A forward migration cannot bring back deleted data; restore it from a backup.

## Visual comparison

The visual lane (#257) compares 12 key screens, listed in `tests/visual-lane/screens.json` (capped at 15), each in
Arabic at 1440 and 390, light and dark, byte for byte with its images in `tests/visual-lane/images/`
(`<screen>-ar-<width>-<light|dark>.png`, no platform suffix). One browser pinned by digest draws them, so every machine
makes the same bytes. It runs on `main` only (`./ci.sh visual`); a failure there opens the `visual-regression` issue,
with the difference images in the `lane-screenshots` artifact. `tests/visual-baselines.test.mjs` fails when a screen
lacks an image or an image has no screen.

When a change intentionally alters one of those screens, one command refreshes its images: `./ci.sh visual-update`
(Docker needed). Without Docker, run the `Visual baselines` workflow on the branch and download its `visual-baselines`
artifact into `tests/visual-lane/images/`. Commit the images with the change that caused them.

## Code Review Rules

### The issue is the contract
- The PR body starts with `Closes #<n>` and lists the issue's acceptance items. Flag an acceptance item with no code or test in the diff, and code that goes beyond the issue.

### Existing tests keep their meaning
- Flag an existing test that is deleted, skipped or loosened so it no longer proves what it proved, and a refreshed screenshot baseline with no matching screen change in the diff.
  Safe path: new tests, or a baseline refresh for screens the issue changes.

### Company isolation and roles
- Company data is reached only through the caller's own company (ADR 0004), and Owner-only actions are checked on the server. Flag a `service_role` query with no owner or company filter, and a permission check that exists only in the browser.

### Keys and secrets
- The Hermes key comes only from the server's environment (`HERMES_API_KEY`), and a Company's model provider keys are kept in the Engine; none is returned to the browser or logged (ADR 0017). Flag request bodies, headers or exception text written to logs on a route that receives a key.

### Database changes
- `install.sh update` applies migrations by itself, before the new app version starts. Flag a migration that drops or rewrites existing data when the issue does not say so, and one the previous app version cannot run against.
