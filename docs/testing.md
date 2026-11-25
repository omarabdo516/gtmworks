# Tests: what each file guards

Every file under `tests/` keeps its row beside it, in `tests/rows/` (#69, #229): the product promise it guards, how long it
runs, the other test that also guards that promise, and the decision. `node scripts/testing-doc.mjs --print` prints those
rows as two tables, sorted by path, and `./ci.sh static` fails when a test file has no row, a row names no file, or a row
file keeps two rows for its own file. A test is removed or merged only when another test
already proves its promise, when it checks only implementation detail or wording nobody depends on, or when it re-proves a
step every other test walks through. The first-run setup link (#50), the release install and update (decision 0015),
contrast, and the English/Arabic direction checks are never removed.

## What runs when: how CI runs them

As Hermes and T3 Code run their CI (#76): a first job decides what runs, the fast layers run on every pull request, and
the whole-app browser and install suites run only when their own area changed, on `main`, or when asked for by hand.
Every job runs on a GitHub-hosted `ubuntu-latest` runner (decision 0038, #334). The visual lane runs in its own `visual`
job, followed by the measured navigation budgets, which need a machine no other job shares; `ci.sh
integration` leaves the `measured` project empty (`GTMWORKS_HOSTED_ELSEWHERE`). The visual lane and the measured budgets
run on a push to `main` and on a manual run only, never on a pull request, and `check` does not wait for them (Omar,
2026-11-17, #257). The chat's open time needs a machine no shard shares too, so it runs in its own `chat-open` job, on a
pull request too (#421): `ci.sh integration` leaves the `alone` project empty (`GTMWORKS_HOSTED_ELSEWHERE`), and
`./ci.sh chat-open` runs it with one lane, one build and the one test. When they fail on `main`, the `visual` job opens
or updates one issue labelled `visual-regression` that names each failed screen and links the difference images
(`scripts/visual-regression.mjs`); no pull request is blocked by it. A job that
starts the local Supabase stack first reserves its ports (`scripts/ci-runner.mjs reserved-ports`, #225).

- `changes` decides which suites a change needs (`scripts/ci-areas.mjs`, like Hermes `detect` and T3 Code `Changes`).
  A change to the CI definition itself (`ci.yml`, `ci.sh`, the area, verdict, runner and fast-runner scripts) or to `package.json`
  and its lock runs every suite; an empty, malformed or unreadable change list runs every suite; a push to `main` runs
  every suite unless every changed file is a document.
- A draft pull request runs what a ready pull request runs (#405, replacing the draft rule of #333): the database,
  browser and install suites start when their own files change, on a draft as on a ready one, and `check` is red when
  one of them failed or was skipped while its files needed it. Marking a draft ready starts nothing by itself.
  `tests/ci-draft.test.mjs` evaluates the real workflow and area script for each of these events.
- `fast` runs on every change, as one job (#258): the `node --test` files, lint, types, the unused-code check (`knip`,
  `knip.json`, as T3 Code runs it, #81), the catalogue and OpenAPI checks, and the screens as components in headless
  Chromium (Vitest browser mode, `vitest.config.mts`, `tests/components/`, in one run, no shards). `./ci.sh fast`
  starts them all at once (`scripts/ci-fast.mjs`), prints each one's output whole when it ends and lists each one's
  result; `check` lists them again, so a red lint shows beside the green rest. `./ci.sh static` is the same without
  the component tests and `./ci.sh components` is the component tests alone. The job restores `node_modules` by the
  lock file's hash and Chromium by Playwright's version, each saved straight after a fresh install, so the bundler's
  own cache (`node_modules/.vite`) is never restored and the component tests always start it cold.
  Each step also writes its output as it runs to `ci-ledger/<job>/<step>.log`; a red step's output is printed last, after the step list. A cache
  miss installs the browser alone, as a hit restores it, so every run draws on the runner image's own system packages
  and fonts; the key also names the image. Outside CI the component step installs the browser itself, after the
  discovery gate. the pinned OpenAPI linter keeps an npm cache of its own (`NPX_CACHE`), restored by its version, so a hit lints offline.
  Test discovery runs first and every other step waits for it; the test runners run at a lower CPU priority, so lint
  and types keep a core each. `tsconfig.json` leaves out `test-results/`, where the node tests write sandbox `.ts` files.
  `component-imports.test.mjs` fails there in seconds when a component test's imports reach `server-only` (#218).
  The component tests run when `app/`, `components/`, `lib/` or the component tests change, and when a file the motion
  test reads changes: the motion table (with the widths and languages it is compared at) and its reader, the reference
  and `postcss.config.mjs` (#127); otherwise their step is listed as skipped.
- `database` runs the migration verifications, `check-rls.sql` and `tests/db.sh` (RLS, grants, migrations replayed on
  legacy data) on one local stack, when `supabase/` or a database test file changes. The verifications run in one psql
  session, each file in its own connection and read-only transaction and reported by name (`scripts/verify-db-session.mjs`);
  a verify file is one statement with no psql command, and a canary file checks on every run that the session fails a
  failing file. The migration replays run in one pgTAP session, each reported by name (#259).
- Every lane's stack starts the services `supabase/config.toml` enables, lane 0 and the local stack
  (`scripts/local-db.sh`) included: Studio, analytics (the log services) and the edge runtime are off, as nothing uses
  them. To open Studio on your own machine, set its `enabled` back to `true` locally; do not commit it.
- The stacks' Supabase images come from one archive in the Actions cache, keyed by the Supabase CLI's version and the
  lines of `supabase/config.toml` that choose images (`scripts/supabase-images.sh`). The `supabase-images` job keeps
  it: with the key cached it only looks the key up, and after a key change it pulls the images on an empty project (no
  migrations, so a broken one cannot stop it) and saves them. `database` and a GitHub-hosted `integration` restore the
  archive when it is there and otherwise pull for themselves, without waiting; `visual`, on main only, waits for it. A
  warm cache makes no registry call, the job never fails a run, and each job log ends with how many images the registry
  served.
- `image` builds the app image once per run, when the browser suite or the install proof is asked for, and on every
  manual run, where the profile-size measurement runs (#403, #406, #408),
  with its layers kept between runs (`cache-from: type=gha`, `cache-to: type=gha,mode=max`), so a change that leaves the
  dependencies alone restores them. It passes `NEXT_SKIP_CHECKS=true`, so `next build` repeats no lint and no type check
  `fast` already ran (`next.config.mjs`); a release image and a local build keep both. It uploads the image as the
  `gtmworks-image` artifact, kept for a day and stored uncompressed. `integration`, the install proof and the
  measurement job wait for it and load that image from the artifact: no shard and no install area builds an image of its
  own, and `check` is red when the build failed or was cancelled.
- `integration` is the whole-app browser suite: the production-shaped proxy suite, then the functional journeys and
  first run, on the image the `image` job built, loaded from its artifact (a shard builds nothing, #403). Its dependencies and its browser come from the caches the `fast` job keeps, restored by the same keys (the
  lock file's hash for `node_modules`; Playwright's version and the runner image for the browser), and a miss installs
  Chromium alone: the runner image has its system packages and fonts, so no shard downloads a browser, a package or a
  font during a run (#404). It runs as 10 shards at the same time (a matrix
  passing `--shard=<i>/10` to `./ci.sh integration`, #335, which runs the spec files `scripts/browser-shards.mjs` gives
  shard i, split by measured time, #653), each on a GitHub-hosted runner with stacks of
  its own; the proxy suite runs in shard 1 only, and each shard uploads its screenshots, report and server logs under
  its own number. `check` is green only when all ten shards passed: with fail-fast off, the matrix's one result is red
  when any shard is (`scripts/ci-verdict.mjs`). All of it runs when the journeys' own area changes: a browser spec or
  its helpers, the fake engines, the Playwright configs, the stacks it runs on (migrations, stack configuration, local
  default privileges, the first-run reset helpers, the image the proxy suite runs in), the seed, `public/`, and the code
  the journeys drive that no component test covers. That code is the server code under `app/` (its `.ts` route handlers
  and server actions, where the server checks permissions), `lib/` outside the catalogues, `worker/` and the root files
  the build and server read. Screens alone (the rest of `app/`, `components/`, the catalogues in `lib/messages/`, the
  visual lane's files) start no browser job on a pull request (#257). Its suite runs on `GTMWORKS_TEST_LANES`
  lanes (four in CI), one per Playwright worker:
  each lane is a whole local Supabase stack and an app server of its own (`tests/lane.mjs`, `scripts/local-db.sh`,
  `scripts/web.sh`), so spec files run side by side and never share data.
  Each functional spec file starts from the seed (`tests/fresh-seed.ts`); tests inside one file still run in order.
  The order is functional, then first run; the chat's open time and the faces' frame rate (project `alone`,
  `chat-steps.spec.ts` and `face-frames.spec.ts`, one worker and no other browser beside it, #346, #697) and the navigation time budgets (project `measured`) are empty here: they run in
  their own jobs with the machine to themselves (`chat-open`, #421, and `visual`), and a failure in one group skips none
  of the next.
- `chat-open` is the chat's open time (#346, #421) with a machine to itself, on a pull request too: `./ci.sh chat-open`
  starts one lane's stack, builds the app, and runs `npx playwright test --project=alone --no-deps`, so the test in
  `tests/chat-steps.spec.ts` measures the click-to-steps time with no other browser, stack or worker beside it. The
  budget is one second (decision 0042) and is never raised. On the same quiet machine `tests/face-frames.spec.ts`
  measures sixteen moving faces on a CPU slowed four times: 50 frames a second or more, and no long task of their own
  (#697). A change to it runs it with the browser suite's own area,
  on a draft as on a ready pull request, and `check` is red when its job failed or was cancelled or was skipped while
  the browser suite was asked for (`scripts/ci-verdict.mjs`).
- `visual` is the visual lane (#257), on `main` and on a manual run only: the fourteen key screens in
  `tests/visual-lane/screens.json` (sign-in, first run, Home, the board, a Card, the chat, a channel, Agents, an
  Agent's details, Members, Numbers, Approvals, a proposed change in Omar's chat with Lead (#19) and Recurring tasks (#31); the list is capped
  at 15), each in Arabic at 1440 and 390 in the light and dark themes, compared byte for byte with
  `tests/visual-lane/images/` (52 images). One browser pinned by
  digest (`tests/visual-lane/renderer`) draws them in its container through Playwright's own server, so every machine
  makes the same bytes; the tests, the app and lane 0's stack stay on the runner (`playwright.lane.config.ts`). Each
  screen starts from the seed and signs in again, so the screens pass in any order. Text that follows the calendar is
  replaced by fixed text before the picture (the log's day-group header, times and the chart labels, #276), so a run
  that crosses midnight draws the same bytes. Before each comparison the guards
  (`tests/visual-lane-guards.ts`) refuse a font that did not load, a clock that is not fixed and a request off the
  machine; every dark picture keeps its text at 4.5:1, and the light Home, board and Card keep their quiet text at 4.5:1
  and weaker than the body text. Then the measured navigation budgets run. When a picture changes on purpose, one
  command refreshes the images: `./ci.sh visual-update` (Docker needed; without it, the `Visual baselines` workflow
  uploads them as `visual-baselines`).
- Design parity is checked once, at delivery, outside CI (Omar, 2026-11-17, #257). The worker that delivers a screen
  compares it with its design in `design/` in T3's preview, motions included, at the widths and in the languages the
  design shows, and attaches the evidence (side-by-side images, and a recording for each motion) to the pull request
  that delivers it. No CI job compares a screen with `design/`, and no animation frame is sampled in CI.
- `install` is the Docker install, update, backup, restore, release and one-line install. The proof is one job of one
  matrix entry per area of the repo's proof, each on a fresh isolated Docker machine of its own and named for its area
  (#406): `install-first-install` (the first install and its repeat), `install-companies` (Companies and their Engines,
  #407), `install-agents` (Agents on their Engines, #408), `install-agents-sandbox` (an Agent's work in its Company's
  sandbox, #553), `install-open-design` (the Open Design app, #544), `install-backup` (backup and restore, #409), `install-backup-engines` (every Company's Engine backed up
  and restored, #553),
  `install-proxy` (the public address behind a proxy), `install-rollback` (a failed update rolled back, #389),
  `install-update` (the update between releases), `install-previous-archive` (the previous release's own archive restored, #389), `install-release-update` (the latest published release, read from the releases list on every run, installed from its own two files and updated to this one, #483), `install-sandbox-update` (an install the release before the work sandbox made, with two Companies, updated to this one, #397), `install-staged-update` (the staged removal of Agent levels, ADR 0023), `install-sandbox-rollback` (a failed update of an install with two sandbox-enabled Companies rolled back, each Engine reaching its own sandbox over SSH again, #504, and the install recording the release that keeps serving, so backup runs with that release's files, #583), `install-sizes` (the measured sizes: idle memory, one short render at the default sandbox limits, and a render stopped at a low limit while the other Company's sandbox answers, #400), `install-engines-update` (a release that pins another Engine
  image, #389) and
  `install-one-line` (the one-line install). Each entry is one command of the repo, `bash scripts/ci-install-check.sh
  <area>`; here `./ci.sh install first-install`, `./ci.sh install companies`, `./ci.sh install agents`, `./ci.sh install agents-sandbox`, `./ci.sh install open-design`,
  `./ci.sh install backup`, `./ci.sh install backup-engines`, `./ci.sh install proxy`, `./ci.sh install rollback`, `./ci.sh install update`, `./ci.sh install previous-archive`, `./ci.sh install release-update`, `./ci.sh install sandbox-update`, `./ci.sh install staged-update`, `./ci.sh install sandbox-rollback`, `./ci.sh install sizes`, `./ci.sh install engines-update` and `./ci.sh install one-line` each run one
  area, and `./ci.sh install` runs the whole proof (`docs/agents/checks.md`) — and holds no check of its own, so a red
  entry's name is the area that failed and fail-fast is off: one red area leaves the others running to their end. A new area is one more
  matrix entry and one more case of the script. Every area is independent: each makes the install, its first run, the
  Companies, the archives, its local registry and its release files itself, so no area needs another to have run (#406,
  #407, #408, #409); the profile-size measurement is the `install-measure` job below. Every entry loads the one image
  the `image` job built, tagged as the source install's own compose file names (read from `docker-compose.install.yml`,
  #411), and the installer skips its build for it and says so in one line (`GTMWORKS_IMAGE_PREBUILT`, tests only); the
  update area still builds the previous release, the last one before the Engines at a fixed commit, which is a different
  image (#378, C1), so only it checks the history out in full. A job on a GitHub-hosted runner does not wait for its Docker machine's removal. It
  runs when the image, its build inputs, the install and release files, the migrations it applies or its own checks
  change, and when `lib/` outside the catalogues, `worker/`, `next.config.mjs` or `server.js` change: only the install
  drives that code against the real bundled Hermes.
  Its profile proof (#126) runs on the pinned Engine: two Companies with a main and a second
  Agent each, every Agent on its own profile and every Company on its one shared space, the tools off and a Run on a
  shared space refused, memory and a shared Skill reaching only the first Company's Agents, a key set for one Company
  only, and the database refusing a row of one Company that names the other's profile. Every line is a name, a state or
  a count (`lib/install-proof.mjs`), and the secrets scan that follows covers every Engine.
- `install-measure` is the profile-size measurement (#126, #400): twenty more Agent profiles in one Company, ten with
  the Engine's bundled Skills and ten without; it prints each one's seconds to be ready, the Engine container's memory
  around them, the disk one profile takes with and without its Skills, and one line of numbers. It is no check a pull
  request needs, so it runs on a push to `main` and on a manual run only, never on a pull request, like the visual lane
  (#408, Omar, 2026-11-19); `check` does not wait for it. It makes the install and the two Companies its prepare step
  reads on a fresh isolated Docker machine of its own, and loads the run's one image. The numbers the README states come
  from its log, line `capacity: …`.
- A manual run (`gh workflow run ci.yml --ref <branch>`) runs the fast job and the database; the browser suite and the install
  run only with `-f e2e=true` and `-f install=true`, both off by default (like Hermes `e2e` and `e2e_upgrade`). The
  profile-size measurement and the image it loads run on every manual run.
- `check` is the one required check (like Hermes `all-checks-pass`): a suite `changes` did not ask for passes only when
  it was skipped; one it asked for must succeed; a failed or cancelled stage is red; it lists each step of the fast job
  and every step must succeed (`scripts/ci-verdict.mjs`). The install proof is one stage (#406): its matrix is red when
  any area failed or was cancelled, and it passes skipped only when the install proof was not asked for. The chat's open
  time is one stage too (#421): it passes skipped only when the browser suite was not asked for. The
  profile-size measurement is no stage: `check` never waits for it (#408).
- Every test runs offline (#266). `tests/offline.mjs` holds one table of what is local: `localhost`, the special-use
  names `.localhost`, `.test`, `.example` and `.invalid` (RFC 6761, never delegated), loopback and unspecified
  addresses, and Unix sockets; everything else is outside, `example.com` and private LAN addresses included. `npm test`
  and `ci.sh static` load it before every node file, and it adds itself to `NODE_OPTIONS` by its own address, so every
  node process a test starts carries it, from any folder; a connection to an outside host is refused naming the host,
  and under `node --test` a process that swallowed the refusal still fails. Both Playwright configs and
  `vitest.config.mts` load it in their runner, and the worker and server each browser lane serves load it too (the
  build, which fetches the Google fonts, does not). Every refusal of a Playwright run, by any process it started, goes
  to the run's own log, and the configs' global teardown fails the run naming each host and the process, so a server
  that swallowed one still turns the run red; under `node --test` each file reads the log its own children wrote, and
  fails the same way. The process that made a log removes it when it exits.
  In the browser, `tests/offline-browser.ts` (through `tests/fresh-seed.ts`, `first-run.spec.ts` and
  `proxy/production-shape.spec.ts`) and `vitest.config.mts` launch Chromium behind a proxy nothing answers, which every
  local name bypasses, so every outside request, WebSocket and redirect hop fails; nothing is routed, since routing
  turns off the browser's cache and changes the headers a test reads. Each context reports the outside addresses it
  tried: a test fails naming each host, and one a hook tried is kept for the worker, with the test before it, and fails
  the worker when it ends. `tests/components/offline-setup.ts` fails a component test the same way. Name lookups are
  not guarded. The visual lane (#257, which aborts outside requests with guards of its own) and
  the install suite, which drives a real install on purpose, are not guarded, nor yet the containers' network.
  `provider-hosts.test.mjs` fails `static` when a tracked file under `tests/` names a real model provider host
  (`scripts/provider-hosts.mjs`): tests talk to the fake engine, the fake Hermes or the install proof's fake provider.
- The nightly `Time zones` workflow (`time-zones.yml`, #266) runs the node tests (`npm test`) and `./ci.sh components`
  under `TZ=Africa/Cairo` and `TZ=America/Sao_Paulo`. The day boundary is checked with fixed instants in the runner's
  zone, so it holds whatever the hour; the run is set for 02:35 UTC, 23:35 in Sao Paulo while Cairo and UTC are on the
  next day, so code that reads the real clock also meets a date that differs from UTC's. It writes each zone's local start and end, whether the run crossed local midnight and each step's outcome
  to the job summary. It holds `contents: read` only and reads no secret. Day boundaries are checked with
  `tests/clock.mjs` in the runner's own zone (`sidebar.test.mjs`), so the same check meets a different midnight in each
  zone. A change to the workflow or its test runs it on its own pull request.

Every job of the full check has a time limit near its budget: one and a half times the minutes measured on run 44636876755,
the first run with every other ticket of spec #401, kept between 3 and 12 minutes; `chat-open` is new in #421, and its
first run confirms the 5 minutes estimated for one lane's stack, one build and the one test. `visual` and `install-measure`
are no part of it and keep the limits they had. A job that runs past its limit ends as cancelled or failed, and `check` is red
either way. `tests/ci-budgets.test.mjs` reads the limits from `.github/workflows/ci.yml` and fails when one rises without
the table changing.

| Job | Measured | Limit |
|---|---|---|
| `changes` | 0.2 min | 3 min |
| `fast` | 2.7 min | 5 min |
| `supabase-images` | 0.1 min | 3 min |
| `image` | 3.7 min | 6 min |
| `database` | 2.1 min | 4 min |
| `integration` | 10.6 min, its slowest shard | 12 min |
| `chat-open` | 5 min, an estimate until its first run | 8 min |
| `install` | 9.5 min, its slowest area (backup) | 12 min |
| `check` | 0.1 min | 3 min |

A pull request that changes only screens runs the fast job with its component tests; the compared screens run on `main`
and on a manual run only (#257), where a failed comparison uploads its expected, actual and difference images in
`lane-screenshots` and the `visual-regression` issue links them. A change to the journeys'
area builds the app image once and runs the whole browser suite on it, and `lib/` outside the catalogues and `worker/`
also run the install. Screens alone get their journeys and install proof on `main`, where every push runs every suite
unless every file is a document.

The tests that guard money, sign-in, permissions and Company isolation run as follows:

- The node tests in `static` (for example `route-permissions.test.mjs`, `hermes-usage.test.mjs`, `password.test.mjs`)
  run on every change.
- The database tests (row-level security, grants, the migration verifications, `tests/db.sh`) run in `database` when
  `supabase/` or a database test file changes.
- The browser specs (for example `conversations.spec.ts`, `agent-visibility.spec.ts`, `password.spec.ts`,
  `usage.spec.ts`, `proxy/production-shape.spec.ts`) run in `integration` when the journeys' area changes. That area
  includes the server code under `app/` and `lib/` outside the catalogues, where the server checks roles and the caller's
  Company.
- Every push to `main` runs all three, and a manual run with `-f e2e=true` runs the whole browser suite.

## Every suite, before and after (#76)

Minutes are the median job time over the last 10 completed pull request CI runs before this change (runs 43608434472 to
43652702879, 14 November 2026; a cancelled or early-failed run is left out of a job's median). Inside `integration`,
the parts are timed from run 43642299138.

| Suite | Layer | What it guards | Before | After | Decision |
|---|---|---|---|---|---|
| changes | classification | which suites a change needs | 0.1 min, every run (decided only docs-only and install) | 0.1 min, every run; decides database, browser and install | keep; one area script replaces `docs-only.mjs` and `install-related.mjs` |
| components: Vitest in headless Chromium, two shards (tests/components/, 10 tests) | screen components | the composer's sending, retry and stop rules in both languages; an Agent's face | none | `app/`, `components/`, `lib/` or its tests; every `main` push | new (#81); with them, screens alone run only the compared screens from the browser suite (#213) |
| static: lint, types, knip, catalogues, OpenAPI, node --test (about 540 tests) | fast, unit | rules in `lib/`, routes and permissions tables, wording, workflow and release files; no unused file, export or dependency (knip, #81) | 1.6 min, every run | 1.6 min, every run | keep |
| database: *.verify.sql, check-rls.sql, tests/db.sh (pgTAP, migration replays) | database | row-level security, grants, company isolation, migrations on legacy data | 1.5 min inside `integration` (plus the stack start), every non-document PR | own `database` job, when `supabase/` or a database test changes; every `main` push | moved to its own job; never removed (isolation and permissions) |
| proxy suite (tests/proxy/, 7 tests) | whole-app browser | sign-in, settings and invitations behind an https proxy | 0.7 min inside `integration`, every non-document PR | inside `integration`: the journeys' area, `main`, or `e2e` input; not for screens alone (#213) | gated |
| browser suite (playwright test, 225 tests on 4 lanes: screens, functional, measured, first run; the chat's open time in its own `chat-open` job, #421) | whole-app browser | journeys, the 72 approved screens, the chat's open time, navigation budgets, first run | 13.3 min of `integration`'s 22.2 min (stack start 4 min, image 2.7 min), every non-document PR | inside `integration`: the journeys' area, `main`, or `e2e` input; screens alone run only the screens (`visual`, #213); the chat's open time in `chat-open` | gated; screens alone run the comparisons only (#213) |
| image health (scripts/ci-image.sh) | whole-app | the built image serves health and runs its worker | inside `integration` | inside `integration`, not for screens alone (#213) | gated with it |
| install | install end-to-end | install, repeat, backup, restore, release update, one-line install, rollback, Agents and their profiles | 15.2 min, PRs touching install files, `lib/`, `worker/` or the app build, every `main` push | its own files and `lib/` outside the catalogues, `worker/`, `next.config.mjs`, `server.js` (the code it drives against the real Hermes); every `main` push; or `install` input | gated as before on a PR; `app/` and `components/` alone still skip it |
| install-measure | install measurement | the disk and memory twenty Agent profiles take, printed for the README | inside `install`, 85 s of every install run | its own job on a push to `main` and on a manual run only, never a pull request, no stage of `check` (#408) | moved off the pull request's path (Omar, 2026-11-19) |
| compare-failures, flaky-tests | our own CI tooling | names failures inherited from main; files an issue per flaky test | 0.1 to 0.2 min after `integration` | none | removed (#81): Playwright's HTML report (uploaded by `integration`) and GitHub reporter show each failure and mark each flaky test |
| check | summary | the one required check | 0.1 min | 0.1 min | keep; judges six stages (the lane, #257) |
| design-compare.yml | design tool | a screen against the design reference | its own paths, or by hand | unchanged | keep |
| visual-baselines.yml | tool | refreshes approved images | by hand | unchanged | keep |
| release.yml install test | release | the release installs and updates from its two files | per release | unchanged | keep |

## Removed tests

| Removed | Why | Still covered by |
|---|---|---|
| `hermes-usage.test.mjs` "a completed run carries the input and output tokens Hermes reported" (#81) | Duplicate: the same `readRun` and token parsing are asserted for a completed run elsewhere. | `hermes-runs.test.mjs` "a run is read as pending until Hermes reports its terminal status, output and session" (usage `{input:14000,output:12}`), and `engine.test.mjs` "the Hermes driver reads a slow run as running, then completed with the reply, session and usage". |
| `hermes-usage.test.mjs` "a run Hermes no longer knows is lost, with unknown usage" (#81) | Duplicate: a cleared run and an unknown id take the same 404 path in the fake and in `readRun`. | Lost with unknown usage: `hermes-runs.test.mjs` "a run Hermes no longer knows is read as lost, not as unreachable". A 500 read as unreachable: `hermes-runs.test.mjs` "a run is read as pending until Hermes reports its terminal status, output and session". |
| `first-run.test.mjs` "destructive first-run helpers refuse remote app and Supabase targets" (#81) | Duplicate: every refusal and the accepted local pair are proven on the same helpers, and there also before any command runs. | `first-run-db.test.mjs` "both helpers refuse remote targets before any command executes" (remote app, remote Supabase) and "first-run reset streams SQL to local psql in a fail-fast transaction" (the local pair is accepted). |
| `app.spec.ts` "landing and screenshots of every charter route" | Its only check was where a person of several companies lands after signing in from the sign-in page; the rest wrote unchecked screenshots. | Landing: merged into `app.spec.ts` "the Owner of every company lands on a Company home from the sign-in page and opens each one with no extra verification step" (the same person, the same page, the same check). Screens: `visual-lane.spec.ts` compares sign-in, Home, approvals and settings members exactly, in Arabic (#257). |
| `compare-failures.test.mjs` and `scripts/compare-failures.mjs` (#81) | They tested and ran our own job that named PR failures also red on main. Playwright's own report replaces the job. | Nothing replaces the job; the HTML report artifact lists each failure of the run. |
| `flaky-tests.test.mjs` and `scripts/flaky-tests.mjs` (#81) | They tested and ran our own job that filed an issue per flaky test. Playwright's own report replaces the job. | Playwright's GitHub reporter and HTML report mark a test that passed only on its retry as flaky. |
| `playwright-journal.test.mjs`, the journal reporter and `docs/ci-test-journal.md` (#81) | They kept our own record of a Playwright run killed before its report, including the tests it never started. #81 removes that record. | Nothing lists the tests a killed run never started; Playwright's list reporter prints in the job log each test that ended. A killed run still fails `check` (`ci-verdict.test.mjs`). |
| `app.spec.ts` "screenshots for unit routes" | It checked nothing beyond signing in, which every test does; it wrote unchecked screenshots. | `visual-lane.spec.ts` compares the members and agents settings screens exactly, in Arabic (#257). |
| `touch-diagnostics.test.mjs` and `touch-diagnostics.mjs` (#218) | They recorded and printed what the page saw during `app.spec.ts`'s touch drag on CI, which keeps no trace of a functional test. The drag now runs as a component test on the test's own clock. | `components/board-touch.test.tsx` (the swipe and the held drag). Nothing replaces the recorder. |
| `ci-verdict.test.mjs` "a draft is red when any stage that ran failed or was cancelled" (#405) | Its only distinct input was the draft flag; the verdict reads no draft state now, so it repeated the per-stage failure checks. | `ci-verdict.test.mjs` "DATABASE: a failed or cancelled run is red, even where it could have been skipped" (and the same for INTEGRATION and INSTALL), "classification and the fast job must succeed", and "a fast step that failed is red even when the job reports success". |

## Flaky tests (#83)

Each open flaky-test issue was repeated with Playwright's own `--repeat-each=20` on `main` after #79, then fixed at its
cause or closed with the repeat that did not reproduce it. No test was moved, removed or loosened, and no retry was added.

| Issue | Test | Root cause | Outcome |
|---|---|---|---|
| #47 | `app.spec.ts` activity times hydrate without errors | Its one failure (React #418, a hydration mismatch) was on a pull request branch before #59 whose other screens also failed; the element that mismatched was not found. | Not reproducible: 20 passed on `main`. |
| #48 | `navigation.spec.ts` drawer targets are at least 44px | The drawer was measured while it slid in (43.99998px wide under the transform). #59 made `openNavigation` wait for the slide to end. | Fixed by #59: 20 passed on `main`. |
| #56 | `navigation.spec.ts` prepared navigation budgets | Measured while functional tests loaded the same runner (211.6ms against 200ms). #69 runs the `measured` project alone after every functional test. | Fixed by #69: see the PR for the 20 runs. |
| #61 | `activity-log.spec.ts` a filter that matches nothing | The who-filter had no option for an unknown value, so after hydration it fell back to everyone and drew all rows. #59 added the "not listed" option. | Fixed by #59: 20 passed on `main`. Moved to `components/activity-log.test.tsx` (#218), which checks the option. |
| #62 | `projects.spec.ts` a project is created, a card is filed into it | The test's `save` ended on any POST's first bytes, so the next save overlapped it and the first save's form reset put back the old goal; a person could do the same with two quick saves. Separately, the board and list project filters took a choice before hydration and dropped it. | Fixed: a project row's Save is busy until its save ends, and `save` waits for it and for the action's own answer; both project filters are disabled until hydrated, as the month filter already was. |
| #64 | `app.spec.ts` touch drag moves a card on a phone | A swipe is a press unless it moves within 250ms; right after the board loaded, the page's own work delayed the first move up to 250ms on a cold runner. The drop was aimed before the drag, and on CI the board moved 218px under the held card. | Fixed: the swipe waits for the board to finish loading; the drag aims at the next list where it is at each step. |
| #70, #86 | `team-work.spec.ts` queued turns | A claim read the next turn before taking the lock a start is recorded under, so meeting a record half done it reserved the started turn again; nothing cleared that reservation, later turns waited forever and the Connection could not be removed. | Fixed in the database: `claim_conversation_turn` takes that lock before it reads (migration `20261215000000`). |
| #73 | `password.spec.ts` sign-in answers wrong and unknown alike | The seed restore met the lane's worker in a deadlock on the #69 branch before it merged; `main` restores in one transaction and repeats it after a deadlock. | Fixed by #69: 20 passed on `main`. |
| #84 | `agent-attachments.spec.ts` a run key downloads the files of its own card | CI twice reset the request client's connection (ECONNRESET). An idle client between 4.9s and 5.1s, around the server's 5s keep-alive, was answered every time, so that was not it. | Left open: no repeat reset a connection; on a host at load above 30, some repeats waited past 5s for the reply's thumbnail. |
| #746 | `main`'s browser shards, a different spec each run (agent-rules, agent-visibility, conversation-files, channel-archive, conversation-archive, card-select, board, …) | A CI shard runs four lanes on a runner of four CPUs, and every page a test opens renders the ten pages its links prefetch in full and reads each face's state for each (#707): an action answered in 5-6 s there and under 1 s on a lane alone. Two faults turned that into red runs. A file that prepares rows in its `beforeAll` restored the seed on its retry only if it passed `testInfo.retry>0` itself, so most retries met their own rows and failed with a duplicate key; and the archive specs spent their Undo toast's 6 s on slower reads before pressing it. | Fixed: `freshSeed(testInfo)` restores the seed in every worker and repeat that runs a file's `beforeAll`; the reads inside an Undo toast's time use the lane's database at once (`laneRows`), not the Supabase CLI; a toast the board raises as it opens the Card starts its time once the Card's page is shown (`board.spec.ts:124`, whose page took longer than the toast's 2.8 s); an expectation waits 10 s in CI. 10 repeats of every listed spec at four lanes: see #753. The per-render cost of face states is #754. |

## Setting a test aside (#336)

A browser test that fails now and then may be set aside for 7 days at most, so one bad test does not block every pull
request (decision 0036). To set it aside:

1. Open an issue for the flaky test, or use the one that already names it.
2. Skip it with Playwright's own skip, `test.fixme(...)` (or `test.skip(...)`), with a one-line comment naming the
   issue. No rerun lane, report or automatic issue exists.
3. Add it to `tests/set-aside.json`: its spec file, its full title as Playwright lists it, the issue number and the date
   it was set aside (`"since": "YYYY-MM-DD"`).

It must come back within 7 days of that date: fix it at its cause, take the skip off and remove its entry. If it cannot
be fixed in time, remove the test in a pull request that names what guards its promise instead (Removed tests above).
A sign-in or Company isolation test is never set aside: a spec whose file name says sign-in or isolation, or a case
whose "stays" row below names sign-in or isolation. `set-aside.test.mjs` turns red when an entry is older than 7 days,
names no issue or names such a test, and when a test Playwright skips is not listed or a listed test is not skipped.

## The browser suite, case by case (#218)

Each case of the `functional` project, as #218 asks. A case stays only when it needs the whole
app: sign-in and first run, a journey across pages, what a Role may do through the server, or Company isolation. Any
other case moved to a component, unit or database test that guards its promise now, or was removed because another test
already guarded it. A case that guards money, sign-in, permissions or Company isolation stays as it is, even where a
faster test guards part of its promise. A moved case's new test was seen failing on a broken version of the behaviour before the case left,
in the pull request that moved it. `testing-doc.test.mjs` checks that every case of a spec listed here has one row and
that only the cases that stay are still in the file. Each spec's case rows live in its row file in `tests/rows/`, under
`## Cases`, beside the file's own row (#229); a spec whose last case moved or was removed is gone from the tree, and its
case rows stay there. `node scripts/testing-doc.mjs --print` prints every spec's cases as a table, sorted by path.

## Money, sign-in, permissions and Company isolation, before and after (#218)

Every case of the `functional` project whose reason in the case rows above names one of these four promises stays in the
browser suite: money (tokens and usage) 9 cases, sign-in (sign-in, passwords, invitations and first run) 21,
permissions (what a Role may do or see through the server) 76, and Company isolation 22. A case can guard more than one.
The cases that moved or were removed and whose words touch these promises guard something else, each named in its own
row: a send stored once, a reply collected after a restart, the composer when the engine is unreachable, the shell's
language and direction, one face per Agent, the sign-in artwork's motion, touch-target sizes, secondary-text contrast
and activity times. The node tests in `static` and the database and row-level security tests in `supabase/tests/`
that guard the four promises lost nothing in any #218 slice: the one change to `supabase/tests/` was #233 adding two
assertions to `work.sql` ("a card is made from the reel template in Ideas" and "the reel template's checklist starts at
Script Ready", its plan from 46 to 48), and `tests/db.sh` is unchanged. After #218 these promises are guarded by the same
tests as before. #338 moved four of the cases that stayed, each checking only the server, to the database tests
(`tests/moved-tests.json` names each one and its new homes): one Company isolation case and three permissions cases, so
the browser suite keeps permissions 73 and Company isolation 21.

## Every file

Browser runtimes are from main's last full CI run before this change (run 43623167814, one worker); `node --test` runtimes
are one local run per file. Helpers are imported by tests and guard nothing alone. Each row lives in `tests/rows/`, as a
file of its own, the file's row first and a spec's case rows under `## Cases`: a new test writes its row beside it, and
`node scripts/testing-doc.mjs --print` prints every row as a table, sorted by path.
