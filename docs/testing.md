# Tests: what each file guards

Every file under `tests/` has a row below (#69): the product promise it guards, how long it runs, the other test that
also guards that promise, and the decision. A test is removed or merged only when another test already proves its
promise, when it checks only implementation detail or wording nobody depends on, or when it re-proves a step every other
test walks through. The first-run setup link (#50), the release install and update (decision 0015), contrast, and the
English/Arabic direction checks are never removed.

## How CI runs them

As Hermes and T3 Code run their CI (#76): a first job decides what runs, the fast layers run on every pull request, and
the whole-app browser and install suites run only when their own area changed, on `main`, or when asked for by hand.

- `changes` decides which suites a change needs (`scripts/ci-areas.mjs`, like Hermes `detect` and T3 Code `Changes`).
  A change to the CI definition itself (`ci.yml`, `ci.sh`, the area and verdict scripts) or to `package.json` and its
  lock runs every suite; an empty, malformed or unreadable change list runs every suite; a push to `main` runs every
  suite unless every changed file is a document.
- `static` runs on every change: the `node --test` files, lint, types, the catalogue and OpenAPI checks.
- `database` runs the migration verifications, `check-rls.sql` and `tests/db.sh` (RLS, grants, migrations replayed on
  legacy data) on one local stack, when `supabase/` or a database test file changes.
- `integration` is the whole-app browser suite: the production-shaped proxy suite, then the screens, the functional
  journeys, the measured navigation and first run. It runs when a browser spec, its helpers, its approved images, the
  Playwright configs, the stacks it runs on (migrations, stack configuration, local default privileges, the first-run
  reset helpers, the image the proxy suite runs in), the seed or `public/` change, and, until screens have component tests, when the app itself changes
  (`app/`, `components/`, `lib/`, `worker/` and the root files the build and server read). Its suite runs on `GTMWORKS_TEST_LANES`
  lanes (four in CI), one per Playwright worker: each lane is a whole local Supabase stack and an app server of its own
  (`tests/lane.mjs`, `scripts/local-db.sh`, `scripts/web.sh`), so spec files run side by side and never share data.
  Each functional spec file starts from the seed (`tests/fresh-seed.ts`); tests inside one file still run in order.
  The screens run first, on the seed as built; the navigation time budgets (project `measured`) run after every
  functional test with the machine to themselves, and first run last.
- `install` is the Docker install, update, backup, restore, release and one-line install. It runs when the image, its
  build inputs, the install and release files, the migrations it applies or its own checks change, and when `lib/`,
  `worker/`, `next.config.mjs` or `server.js` change: only the install drives that code against the real bundled Hermes.
- A manual run (`gh workflow run ci.yml --ref <branch>`) runs static and the database; the browser suite and the install
  run only with `-f e2e=true` and `-f install=true`, both off by default (like Hermes `e2e` and `e2e_upgrade`).
- `check` is the one required check (like Hermes `all-checks-pass`): a suite `changes` did not ask for passes only when
  it was skipped; one it asked for must succeed; a failed or cancelled stage is red (`scripts/ci-verdict.mjs`).

App screens, components, `lib/` and `worker/` changes run static and the whole-app browser suite on the pull request
(review run on #79); `lib/` and `worker/` also run the install, and screens alone get their install proof on `main`. When screens move to component tests in a
headless browser (#81), app changes run those instead and the browser suite goes back to its own area.

## Every suite, before and after (#76)

Minutes are the median job time over the last 10 completed pull request CI runs before this change (runs 43608434472 to
43652702879, 14 November 2026; a cancelled or early-failed run is left out of a job's median). Inside `integration`,
the parts are timed from run 43642299138.

| Suite | Layer | What it guards | Before | After | Decision |
|---|---|---|---|---|---|
| changes | classification | which suites a change needs | 0.1 min, every run (decided only docs-only and install) | 0.1 min, every run; decides database, browser and install | keep; one area script replaces `docs-only.mjs` and `install-related.mjs` |
| static: lint, types, catalogues, OpenAPI, node --test (about 540 tests) | fast, unit | rules in `lib/`, routes and permissions tables, wording, workflow and release files | 1.6 min, every run | 1.6 min, every run | keep |
| database: *.verify.sql, check-rls.sql, tests/db.sh (pgTAP, migration replays) | database | row-level security, grants, company isolation, migrations on legacy data | 1.5 min inside `integration` (plus the stack start), every non-document PR | own `database` job, when `supabase/` or a database test changes; every `main` push | moved to its own job; never removed (isolation and permissions) |
| proxy suite (tests/proxy/, 7 tests) | whole-app browser | sign-in, settings and invitations behind an https proxy | 0.7 min inside `integration`, every non-document PR | inside `integration`: its area or app code, `main`, or `e2e` input | gated |
| browser suite (playwright test, 225 tests on 4 lanes: screens, functional, measured, first run) | whole-app browser | journeys, the 72 approved screens, navigation budgets, first run | 13.3 min of `integration`'s 22.2 min (stack start 4 min, image 2.7 min), every non-document PR | inside `integration`: its area or app code (until #81), `main`, or `e2e` input | gated; screens to become component tests (#81) |
| image health (scripts/ci-image.sh) | whole-app | the built image serves health and runs its worker | inside `integration` | inside `integration` | gated with it |
| install | install end-to-end | install, repeat, backup, restore, release update, one-line install, rollback | 15.2 min, PRs touching install files, `lib/`, `worker/` or the app build, every `main` push | its own files and `lib/`, `worker/`, `next.config.mjs`, `server.js` (the code it drives against the real Hermes); every `main` push; or `install` input | gated as before on a PR; `app/` and `components/` alone still skip it |
| compare-failures, flaky-tests | our own CI tooling | names failures inherited from main; files an issue per flaky test | 0.1 to 0.2 min after `integration` | none | removed (#81): Playwright's HTML report (uploaded by `integration`) and GitHub reporter show each failure and mark each flaky test |
| check | summary | the one required check | 0.1 min | 0.1 min | keep; judges five stages |
| design-compare.yml | design tool | a screen against the design reference | its own paths, or by hand | unchanged | keep |
| visual-baselines.yml | tool | refreshes approved images | by hand | unchanged | keep |
| release.yml install test | release | the release installs and updates from its two files | per release | unchanged | keep |

## Removed tests

| Removed | Why | Still covered by |
|---|---|---|
| `app.spec.ts` "landing and screenshots of every charter route" | Its only check was where a person of several companies lands after signing in from the sign-in page; the rest wrote unchecked screenshots. | Landing: merged into `app.spec.ts` "the Owner of every company lands on a Company home from the sign-in page and opens each one with no extra verification step" (the same person, the same page, the same check). Screens: `visual.spec.ts` compares sign-in, Home, approvals and settings members exactly. |
| `compare-failures.test.mjs` and `scripts/compare-failures.mjs` (#81) | They tested and ran our own job that named PR failures also red on main. Playwright's own report replaces the job. | Nothing replaces the job; the HTML report artifact lists each failure of the run. |
| `flaky-tests.test.mjs` and `scripts/flaky-tests.mjs` (#81) | They tested and ran our own job that filed an issue per flaky test. Playwright's own report replaces the job. | Playwright's GitHub reporter and HTML report mark a test that passed only on its retry as flaky. |
| `playwright-journal.test.mjs`, the journal reporter and `docs/ci-test-journal.md` (#81) | They kept our own record of a Playwright run killed before its report, including the tests it never started. #81 removes that record. | Nothing lists the tests a killed run never started; Playwright's list reporter prints in the job log each test that ended. A killed run still fails `check` (`ci-verdict.test.mjs`). |
| `app.spec.ts` "screenshots for unit routes" | It checked nothing beyond signing in, which every test does; it wrote unchecked screenshots. | `visual.spec.ts` compares the members and agents settings screens exactly. |

## Flaky tests (#83)

Each open flaky-test issue was repeated with Playwright's own `--repeat-each=20` on `main` after #79, then fixed at its
cause or closed with the repeat that did not reproduce it. No test was moved, removed or loosened, and no retry was added.

| Issue | Test | Root cause | Outcome |
|---|---|---|---|
| #47 | `app.spec.ts` activity times hydrate without errors | Its one failure (React #418, a hydration mismatch) was on a pull request branch before #59 whose other screens also failed; the element that mismatched was not found. | Not reproducible: 20 passed on `main`. |
| #48 | `navigation.spec.ts` drawer targets are at least 44px | The drawer was measured while it slid in (43.99998px wide under the transform). #59 made `openNavigation` wait for the slide to end. | Fixed by #59: 20 passed on `main`. |
| #56 | `navigation.spec.ts` prepared navigation budgets | Measured while functional tests loaded the same runner (211.6ms against 200ms). #69 runs the `measured` project alone after every functional test. | Fixed by #69: see the PR for the 20 runs. |
| #61 | `activity-log.spec.ts` a filter that matches nothing | The who-filter had no option for an unknown value, so after hydration it fell back to everyone and drew all rows. #59 added the "not listed" option. | Fixed by #59: 20 passed on `main`. |
| #62 | `projects.spec.ts` a project is created, a card is filed into it | The test's `save` ended on any POST's first bytes, so the next save overlapped it and the first save's form reset put back the old goal; a person could do the same with two quick saves. Separately, the board and list project filters took a choice before hydration and dropped it. | Fixed: a project row's Save is busy until its save ends, and `save` waits for it and for the action's own answer; both project filters are disabled until hydrated, as the month filter already was. |
| #64 | `app.spec.ts` touch drag moves a card on a phone | A swipe is a press unless it moves within 250ms; right after the board loaded, the page's own work delayed the first move up to 250ms on a cold runner. The drop was aimed before the drag, and on CI the board moved 218px under the held card. | Fixed: the swipe waits for the board to finish loading; the drag aims at the next list where it is at each step. |
| #70, #86 | `team-work.spec.ts` queued turns | A claim read the next turn before taking the lock a start is recorded under, so meeting a record half done it reserved the started turn again; nothing cleared that reservation, later turns waited forever and the Connection could not be removed. | Fixed in the database: `claim_conversation_turn` takes that lock before it reads (migration `20261215000000`). |
| #73 | `password.spec.ts` sign-in answers wrong and unknown alike | The seed restore met the lane's worker in a deadlock on the #69 branch before it merged; `main` restores in one transaction and repeats it after a deadlock. | Fixed by #69: 20 passed on `main`. |
| #84 | `agent-attachments.spec.ts` a run key downloads the files of its own card | CI twice reset the request client's connection (ECONNRESET). An idle client between 4.9s and 5.1s, around the server's 5s keep-alive, was answered every time, so that was not it. | Left open: no repeat reset a connection; on a host at load above 30, some repeats waited past 5s for the reply's thumbnail. |

## Every file

Browser runtimes are from main's last full CI run before this change (run 43623167814, one worker); `node --test` runtimes
are one local run per file. Helpers are imported by tests and guard nothing alone.

| File | Promise | Runtime | Also guarded by | Decision |
|---|---|---|---|---|
| `activity-log.spec.ts` | The Activity log filters by person, Agent and Card, pages in a stable order, and shows a Member only their own Company. | 16.2 s | activity-log.test.mjs (wording and filters, no browser) | keep |
| `activity-log.test.mjs` | Each kind of log row says who changed what; the log's filters and days. | 1.6 s | activity-log.spec.ts | keep |
| `agent-attachments.spec.ts` | Files attached in the composer and replies show as thumbnails in both languages; a run key downloads only its own card's files. | 12 s | attachments.test.mjs (how a file is served) | keep |
| `agent-conversation.spec.ts` | People and agents reply inside one card, in order, labelled, each in its own direction. | 3.9 s | — | keep |
| `agent-face.spec.ts` | Shared agents keep distinct, named faces across screens and companies, also after a grant is revoked. | 17.1 s | agent-face.test.mjs (the face generator only) | keep |
| `agent-face.test.mjs` | A shared agent always gets the same face; the four seeded role agents differ. | 0.3 s | agent-face.spec.ts | keep |
| `agent-grants.spec.ts` | An Owner revokes and grants the Writer per company and the agent API follows, in both languages. | 6.4 s | agent-run-keys.spec.ts (run keys follow the grant) | keep |
| `agent-projects.spec.ts` | An agent files its card into a project with a run key, never into another company. | 2.1 s | — | keep |
| `agent-role-backfill.mjs` | replays the agent-role migration on legacy members (tests/db.sh) | — | — | helper, kept |
| `agent-run-keys.spec.ts` | A run key reaches one card, expires, follows the grant and never takes its identity from the request. | 7.5 s | — | keep |
| `agent-visibility.spec.ts` | The Owner turns a Member × Agent switch in Company settings; the Member's sidebar shows the allowed Agent and the main Agent only, and a hidden Agent's address is not found, by page and by the send API. (#15) | — | supabase/tests/member_agent_visibility.sql (every Role, the log, Conversations, the main Agent) | new |
| `alone-team.spec.ts` | A Company worked alone shows no channels, Member permissions or per-member agents and keeps the Activity log; the first invited Member's acceptance makes it a team with every earlier Conversation, Card and log row unchanged. (#10) | — | supabase/tests/alone_team.sql (the switch and its refusal in the database) | new |
| `app-origin.test.mjs` | Behind an HTTPS proxy, first run and sign-in links stay on APP_ORIGIN (#40). | 1.1 s | production-shape.spec.ts | keep |
| `app.spec.ts` | Sign-in, fonts, the card dialog and detail, members and invitations, board moves, approvals, webhooks, contrast and client error reports. | 142.1 s | See the two removed tests below; the rest prove promises no other file does. | keep; 2 tests removed (below); touch drag flake fixed (#83) |
| `attachments.test.mjs` | Only raster images show in place; every download is sandboxed and never sniffed. | 0.4 s | — | keep |
| `board-columns.test.mjs` | The six columns keep the approved order, Waiting on you first. | 0.3 s | board.spec.ts | keep |
| `board.spec.ts` | The board's six columns, drag and keyboard moves (logged), the Agent filter, Viewer limits and Waiting on you. | 48.5 s | board-columns.test.mjs (column order only) | keep |
| `bootstrap-db.mjs` | runs production SQL with real triggers (tests/db.sh) | — | — | helper, kept |
| `bundled-hermes.test.mjs` | The bundled Hermes is one pinned release with no host port and none of gtmworks's secrets. | 3.1 s | install job | keep |
| `card-request.spec.ts` | A message to an agent makes one card in Ideas with its message, assignment and mode; the composer loads on open. | 8.6 s | — | keep |
| `choose-language.ts` | browser helper: choose the language in Settings | — | — | helper, kept |
| `ci-runners.test.mjs` | Every workflow runs on free GitHub-hosted runners and a PR reads no secret. | 0.5 s | — | keep |
| `ci-areas.test.mjs` | Each suite runs only when its own files change; main runs all unless the change is documents only; an unknown list runs all. (new, #76; replaces docs-only and install-related) | 3.1 s | — | new |
| `ci-verdict.test.mjs` | `check` counts a suite as passed only when it was skipped because nobody asked for it, is red on any failed or cancelled stage, and the browser and install inputs default to off. (#69, #76) | 3 s | — | keep, extended |
| `company-log-migration.mjs` | replays the company-log migration (tests/db.sh) | — | — | helper, kept |
| `company-profiles.test.mjs` | Each company has its own Engine profile with its level's toolsets and never a risky one. | 1.1 s | — | keep |
| `company-sign-in.spec.ts` | The Owner signs the company in to ChatGPT and out; a member only sees whether it is connected. | 20.5 s | settings-overlay.test.mjs (the Models slot) | keep |
| `connection-key.test.mjs` | A kept Connection key is read only within its own Company. | 0.3 s | hermes-connections.spec.ts | keep |
| `conversations.spec.ts` | Private conversations: reply without reload, append-only record, isolation by person and company, Viewer refused, restart and lost runs, Hermes unreachable. | 130.7 s | hermes-runs.test.mjs, unknown-starts.test.mjs (driver logic without a browser) | keep |
| `db.sh` | Database tests: RLS, grants and migrations replayed on legacy data (runs the *-migration.mjs and supabase/tests). | 20 s | — | keep |
| `deploy.test.mjs` | Database verification reads plain rows and agent envelopes and names every false key. | 2.7 s | — | keep |
| `design-compare.test.mjs` | The design comparison tool refuses any database but the seeded local one. | 0.6 s | — | keep |
| `design-reference.spec.ts` | The production build answers 404 for the design reference. | 0 s | design-reference.test.mjs (the files, not the route) | keep |
| `design-reference.test.mjs` | The design reference matches its approved checksums, file for file. | 0.3 s | design-reference.spec.ts | keep |
| `engine-agents.test.mjs` | An Agent is one Engine profile made through the management listener with the install key. | 0.7 s | hermes-agents.spec.ts | keep |
| `engine-conversation.spec.ts` | On the fake engine a reply is stored once with usage; failed and stopped runs end with usage; a Viewer is refused; Lead's create_agent call makes the Owner's Agent once, with its log row, and nothing for a Manager. | 28.1 s | conversations.spec.ts (the same flow on fake Hermes) | keep |
| `engine-name.spec.ts` | No page names the Engine, in English or Arabic. | 16 s | engine-name.test.mjs (catalogues only, not rendered pages) | keep |
| `engine-name.test.mjs` | No message value names the Engine, in any language. | 0.3 s | engine-name.spec.ts | keep |
| `engine.test.mjs` | The engine driver runs once per idempotency key, offers tools in a run's instructions and reads at most four calls back from the reply, and never sends a key over plain HTTP to a public address. | 0.6 s | — | keep |
| `fake-engine.mjs` | browser helper: an in-memory engine | — | — | helper, kept |
| `fake-hermes.mjs` | browser helper: a fake Hermes server | — | — | helper, kept |
| `first-run-db.test.mjs` | The first-run reset and seed restore run in fail-fast transactions. | 0.3 s | — | keep |
| `first-run-diagnostics.test.mjs` | First-run refusals log distinct causes; failing tests print only matching server lines. | 2 s | — | keep |
| `first-run-migration.mjs` | replays the first-run migration (tests/db.sh) | — | — | helper, kept |
| `first-run.spec.ts` | An empty install creates its first Owner and Company only through the setup link; wrong codes, short passwords and races create nothing; no password reaches a log. (first-run project, last) | 24 s | setup-code.test.mjs, first-run.test.mjs (route logic without a browser) | keep (decision #50) |
| `first-run.test.mjs` | First run accepts authored names and language and refuses invalid input before provisioning. | 0.4 s | first-run.spec.ts | keep |
| `frame.spec.ts` | The company frame: section order, placeholders, Viewer navigation, Home's four parts, recent cards, the switcher, the drawer and the account menu. | 100.6 s | — | keep |
| `fresh-seed.ts` | browser helper: each spec file starts from the seed (new, #69) | — | — | helper, kept |
| `function-grants-migration.mjs` | replays the function-grants migration (tests/db.sh) | — | — | helper, kept |
| `get.test.mjs` | The one-line install and the gtmworks command: options, versions, update, rollback. (#51, #52) | 14.9 s | install job | keep (decision 0015) |
| `hermes-address.test.mjs` | Public Hermes addresses need HTTPS; plain HTTP only within loopback, private and tailnet. | 0.2 s | hermes-connections.spec.ts | keep |
| `hermes-agents.spec.ts` | The Owner connects, names, attaches and removes agents; concurrent changes serialize; every role sees only its own company's agents. | 42.4 s | engine-agents.test.mjs (the driver) | keep |
| `hermes-connections.spec.ts` | A Hermes Connection is write-only, needs HTTPS in public, refuses wrong keys and outages, and only an Owner of that company manages it. | 57.9 s | hermes-address.test.mjs, hermes.test.mjs, connection-key.test.mjs (the pieces without a browser) | keep |
| `hermes-keys.test.mjs` | Hermes never receives gtmworks's own secrets. | 0.9 s | install job | keep |
| `hermes-runs.test.mjs` | A message starts one run in the conversation session, carrying the sender's note. | 0.5 s | team-work.spec.ts | keep |
| `hermes-usage.test.mjs` | A run carries the tokens Hermes reported, and unknown when none were. | 0.4 s | usage.spec.ts | keep |
| `hermes.test.mjs` | Testing a connection authenticates the profile; wrong keys and outages never offer agent features. | 0.3 s | hermes-connections.spec.ts | keep |
| `hosted-default-privileges.mjs` | checks default privileges on new objects (tests/db.sh) | — | — | helper, kept |
| `install-diagnostics.test.mjs` | An install failure prints only fixed fields, never a secret. | 1.4 s | — | keep |
| `install-proxy.test.mjs` | The proxied install check follows first run to the Company home and fails without the setup code. (#40, #50) | 3.3 s | install job | keep (decision #50) |
| `install.test.mjs` | A failed update keeps the serving containers and prints its log. | 4.5 s | install job | keep (decision 0015) |
| `install/rate-limit.install.ts` | On a real install behind the HTTPS proxy, repeated wrong passwords hit the auth rate limit and the page says so. (install job) | in install job | sign-in-rate-limit.test.mjs (the page and logs without an install) | keep (decision 0015 install checks) |
| `lane.mjs` | browser helper: one whole stack per worker (new, #69) | — | — | helper, kept |
| `language.spec.ts` | English by default, the account language across sessions and devices, automatic content direction, and Arabic sign-in. | 62.6 s | — | keep (direction checks) |
| `lead-agent-migration.mjs` | replays the lead-agent migration (tests/db.sh) | — | — | helper, kept |
| `lead-creates-agent.spec.ts` | The Conversation shows the card for each Agent Lead made (under Lead's reply, or alone when the reply was only the call); the list marks it new for its requester only, until they open it; its page and details say when and at whose request; "New agent" and Settings open Lead's chat focused with a hint line, no form. (#13) | 30.7 s | engine-conversation.spec.ts (the tool call that makes the rows), sidebar.test.mjs (who sees the mark) | new |
| `lead-tools.test.mjs` | Lead's create_agent call is ignored when its tool or arguments do not read, makes nothing until the Engine has the Company's profile ready, then asks the database with the trimmed arguments. | 0.1 s | engine-conversation.spec.ts (the same call on the database) | keep |
| `lessons.test.mjs` | A lesson is proposed only from a run; deciding is a person's action. | 0.3 s | skill-lessons.spec.ts | keep |
| `license.test.mjs` | LICENSE is MIT with the owner's copyright and the package stays private. | 0.6 s | — | keep |
| `member-agent-visibility-migration.mjs` | replays the member-agent-visibility migration: every Member keeps the Agents they saw before the update (tests/db.sh) | — | — | helper, new |
| `member-picker.spec.ts` | Saving a card unchanged clears a next actor who left the company. | 11.2 s | — | keep |
| `migration-statements.test.mjs` | Both migration runners split statements alike and no migration controls its own transaction. | 0.4 s | — | keep |
| `navigation-measure.ts` | browser helper: navigation timing | — | — | helper, kept |
| `navigation-path.test.mjs` | The measured navigation path keeps the Inbox and the Activity log. | 1.4 s | navigation.spec.ts | keep |
| `navigation.spec.ts` | Prepared navigation stays within its time budgets, prefetches, honours reduced motion, invalidates on own changes; drawer tap areas. (measured project, alone) | 56.9 s | navigation-path.test.mjs (the measured path only) | keep |
| `no-agency-strings.test.mjs` | No interface string mentions an Agency or a reviewer. | 0.6 s | — | keep |
| `numbers.spec.ts` | The Numbers page shows its empty state with no app and lists what waits on its reader. | 1.8 s | numbers.test.mjs (figures and sources) | keep |
| `numbers.test.mjs` | Every Numbers figure comes from a connected app with its source and period. | 0.8 s | numbers.spec.ts | keep |
| `one-company-install.test.mjs` | Docs and the Owner's warning say each company has its own profile. | 1.7 s | shared-engine.spec.ts | keep |
| `password.spec.ts` | Sign-in answers wrong and unknown alike; forgot-password, authenticator, invitation and settings password changes all work. | 21.4 s | password.test.mjs (the rule only) | keep |
| `password.test.mjs` | A password needs 10 characters (not bytes) and a matching confirmation. | 1.3 s | password.spec.ts | keep |
| `phone-tap-areas.spec.ts` | At 390px the Numbers and Activity log controls keep 44px tap areas. | 1.4 s | — | keep |
| `playwright-projects.test.mjs` | Screens run first on the seed, functional next, first run last, and a failure in one group hides none of the others. | 77.8 s | — | keep |
| `projects.spec.ts` | Projects are created, cards filed into them, Viewers read only, and a later change by someone else is not overwritten. | 23.3 s | — | keep; flaky cause fixed (#83) |
| `proxy/production-shape.spec.ts` | Behind a proxy on https and a public-looking host, sign-in, settings and invitations work. (own config) | 14 s | install job (the same through a real install) | keep |
| `public-tree.test.mjs` | The public tree carries no superseded decision or private wording. | 0.7 s | — | keep |
| `release.test.mjs` | Releases pin every image, publish one tested image and are proven before publishing. (decision 0015) | 4.8 s | install job | keep (decision 0015) |
| `remove-agency-harness.test.mjs` | The Agency removal harness removes everything before it replays the migration. | 0.2 s | — | keep |
| `remove-agency-migration.mjs` | replays the Agency removal (tests/db.sh) | — | — | helper, kept |
| `reviewer-conversion.test.mjs` | The reviewer conversion locks what it reads while the old app still serves. | 0.2 s | — | keep |
| `role-labels.test.mjs` | A member row shows the Role and, for an Owner, a Contributor's Agent role. | 0.3 s | — | keep |
| `route-permissions.test.mjs` | Every server route and action is in the permission table; a missing one needs Owner. | 3.2 s | — | keep |
| `secret-text.test.mjs` | The note form and the database refuse the same secrets. | 0.2 s | team-work.spec.ts | keep |
| `settings-overlay.spec.ts` | The Settings overlay opens over the page, lists the real Agents, lets only the Owner rename, and fits a phone. | 28.5 s | settings-overlay.test.mjs (sections per role) | keep |
| `settings-overlay.test.mjs` | The overlay lists the reference's sections, and a Viewer sees only theirs. | 0.3 s | settings-overlay.spec.ts | keep |
| `setup-code.test.mjs` | The setup code has 256 bits, is compared exactly and travels only after `#`. (#50) | 1.9 s | first-run.spec.ts, install job | keep (decision #50) |
| `shared-engine.spec.ts` | The Owner is warned, in English and Arabic, while two companies share the bundled Engine profile. | 21.1 s | one-company-install.test.mjs (docs and logic) | keep |
| `shell-wording.test.mjs` | Empty states and notes speak the reference's Egyptian Arabic. | 0.2 s | — | keep |
| `sidebar.test.mjs` | The Inbox entry stays named at zero; the account menu offers Light, Dark and Device; an Agent Lead made is new only for its requester until opened, never the main Agent. | 0.5 s | theme.spec.ts | keep |
| `sign-in-rate-limit.test.mjs` | The sign-in page says to try later on 429, and never logs the password. (#41) | 3.4 s | rate-limit.install.ts | keep |
| `sign-in.ts` | browser helper: sign in and read emailed links | — | — | helper, kept |
| `skill-lessons.spec.ts` | An agent proposes a lesson from its run; approving adds it to the skill and rejecting does not. | 37.5 s | lessons.test.mjs (route pieces) | keep |
| `skills.spec.ts` | A member installs and enables a skill for the Writer, a bad skill is refused, and the agent reads exactly its enabled skills. | 17.3 s | skills.test.mjs (the library) | keep |
| `skills.test.mjs` | Every library skill is valid and installs only from the stored catalogue. | 0.2 s | skills.spec.ts | keep |
| `split-catalogues.test.mjs` | Every key a split catalogue owner asks for exists in both languages. | 0.2 s | — | keep |
| `sql-statements.mjs` | helper: split SQL into statements | — | — | helper, kept |
| `tap-overlaps.spec.ts` | The tap-overlap measure used by the phone checks counts what really overlaps. | 0.3 s | — | keep |
| `tap-overlaps.ts` | browser helper: tap-area overlap measure | — | — | helper, kept |
| `team-work.spec.ts` | Queued turns run in order, lost answers are retried once, stop and roles are enforced, authors come from the session, notes stay private. | 85.6 s | unknown-starts.test.mjs, hermes-runs.test.mjs (driver logic) | keep; flaky cause fixed (#83) |
| `test-discovery.test.mjs` | npm test discovers a new nested test file and its failure. | 4.3 s | — | keep |
| `testing-doc.test.mjs` | docs/testing.md keeps one row per file under tests/. (new, #69) | — | — | new |
| `theme.spec.ts` | The device theme by default, the saved choice across sessions and devices, and the sun/moon toggle. | 6.9 s | sidebar.test.mjs (the menu entries) | keep |
| `touch-diagnostics.mjs` | browser helper: touch recorder | — | — | helper, kept |
| `touch-diagnostics.test.mjs` | Touch diagnostics print only bounded numbers and known words. | 0.2 s | — | keep |
| `unit.test.mjs` | Glossary terms, Role-only access and other small rules across lib/. | 2 s | — | keep |
| `unknown-starts.test.mjs` | A start whose outcome was unknown stays unknown until Hermes names the run. | 0.3 s | team-work.spec.ts | keep |
| `usage.spec.ts` | Replies store their tokens and show a running total; stopped and lost runs keep what was reported; an Owner sees each company's tokens. | 23.8 s | hermes-usage.test.mjs (the parsing) | keep |
| `visual-baselines.test.mjs` | Every listed screen has its approved images and no image lacks a screen. | 0.4 s | visual.spec.ts | keep |
| `visual-screens.mjs` | helper: the compared screens | — | — | helper, kept |
| `visual.spec.ts` | Thirty screens match their approved images in English and Arabic at 390 and 1440, light and dark, on the seed as built. (visual project, first) | 83.6 s | visual-baselines.test.mjs (every screen has its images) | keep |
| `visual.spec.ts-snapshots/` | The 96 approved screen images `visual.spec.ts` compares with. | — | — | data, kept |
