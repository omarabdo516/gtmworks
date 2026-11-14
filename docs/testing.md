# Tests: what each file guards

Every file under `tests/` has a row below (#69): the product promise it guards, how long it runs, the other test that
also guards that promise, and the decision. A test is removed or merged only when another test already proves its
promise, when it checks only implementation detail or wording nobody depends on, or when it re-proves a step every other
test walks through. The first-run setup link (#50), the release install and update (decision 0015), contrast, and the
English/Arabic direction checks are never removed.

## How CI runs them

- `static` runs the `node --test` files, lint, types and the catalogue checks.
- `integration` runs the database tests, the production-shaped proxy suite, then the browser suite. That suite runs on
  `GTMWORKS_TEST_LANES` lanes (four in CI), one per Playwright worker: each lane is a whole local Supabase stack and an
  app server of its own (`tests/lane.mjs`, `scripts/local-db.sh`, `scripts/web.sh`), so spec files run side by side
  and never share data. Each functional spec file starts from the seed: before its first test the lane's data is put
  back from a snapshot taken right after seeding (`tests/fresh-seed.ts`). Tests inside one file still run in order.
  The screens still run first, on the seed as built. The navigation time budgets (`navigation.spec.ts`, project
  `measured`) run after every functional test with the machine to themselves, as they did when the suite was serial,
  and first run last.
- `integration-2` (#74) runs at the same time on a second standard runner, with four lanes of its own: only the
  functional files `tests/browser-jobs.mjs` lists, which `integration` then leaves out (`GTMWORKS_BROWSER_JOB`). They
  are the long files, chosen so both jobs end at about the same time; a new spec file runs in `integration` until it
  is listed. A local `./ci.sh check` sets no job and runs the whole suite in one run. `check` needs both jobs, and
  `flaky-tests` and `compare-failures` read both jobs' reports (`playwright-report`, `playwright-report-2`).
- `install` runs on every push to `main`, and on a pull request only when it changes a file the install exercises
  (`scripts/install-related.mjs`): the image and its build inputs, install and release files, the database, `lib/`,
  `worker/` and the workflows. `check` allows a skipped install only then, and is red on any failed or cancelled stage
  (`scripts/ci-verdict.mjs`).

## Removed tests

| Removed | Why | Still covered by |
|---|---|---|
| `app.spec.ts` "landing and screenshots of every charter route" | Its only check was where a person of several companies lands after signing in from the sign-in page; the rest wrote unchecked screenshots. | Landing: merged into `app.spec.ts` "the Owner of every company lands on a Company home from the sign-in page and opens each one with no extra verification step" (the same person, the same page, the same check). Screens: `visual.spec.ts` compares sign-in, Home, approvals and settings members exactly. |
| `app.spec.ts` "screenshots for unit routes" | It checked nothing beyond signing in, which every test does; it wrote unchecked screenshots. | `visual.spec.ts` compares the members and agents settings screens exactly. |

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
| `app-origin.test.mjs` | Behind an HTTPS proxy, first run and sign-in links stay on APP_ORIGIN (#40). | 1.1 s | production-shape.spec.ts | keep |
| `app.spec.ts` | Sign-in, fonts, the card dialog and detail, members and invitations, board moves, approvals, webhooks, contrast and client error reports. | 142.1 s | See the two removed tests below; the rest prove promises no other file does. | keep; 2 tests removed (below) |
| `attachments.test.mjs` | Only raster images show in place; every download is sandboxed and never sniffed. | 0.4 s | — | keep |
| `browser-jobs.mjs` | browser helper: which functional files CI's second integration job runs (new, #74) | — | — | helper, kept |
| `browser-jobs.test.mjs` | The two integration jobs run every functional file exactly once, and the first keeps screens, budgets and first run. (new, #74) | 7 s | — | new |
| `board-columns.test.mjs` | The six columns keep the approved order, Waiting on you first. | 0.3 s | board.spec.ts | keep |
| `board.spec.ts` | The board's six columns, drag and keyboard moves (logged), the Agent filter, Viewer limits and Waiting on you. | 48.5 s | board-columns.test.mjs (column order only) | keep |
| `bootstrap-db.mjs` | runs production SQL with real triggers (tests/db.sh) | — | — | helper, kept |
| `bundled-hermes.test.mjs` | The bundled Hermes is one pinned release with no host port and none of gtmworks's secrets. | 3.1 s | install job | keep |
| `card-request.spec.ts` | A message to an agent makes one card in Ideas with its message, assignment and mode; the composer loads on open. | 8.6 s | — | keep |
| `choose-language.ts` | browser helper: choose the language in Settings | — | — | helper, kept |
| `ci-runners.test.mjs` | Every workflow runs on free GitHub-hosted runners and a PR reads no secret. | 0.5 s | — | keep |
| `ci-verdict.test.mjs` | `check` allows a skipped install only on a PR with no install file, needs both integration jobs (#74), and is red on any failed or cancelled stage. (new, #69) | 3 s | — | new |
| `company-log-migration.mjs` | replays the company-log migration (tests/db.sh) | — | — | helper, kept |
| `company-profiles.test.mjs` | Each company has its own Engine profile with its level's toolsets and never a risky one. | 1.1 s | — | keep |
| `company-sign-in.spec.ts` | The Owner signs the company in to ChatGPT and out; a member only sees whether it is connected. | 20.5 s | settings-overlay.test.mjs (the Models slot) | keep |
| `compare-failures.test.mjs` | A PR's failing tests are told apart from those inherited from main. | 0.3 s | — | keep |
| `connection-key.test.mjs` | A kept Connection key is read only within its own Company. | 0.3 s | hermes-connections.spec.ts | keep |
| `conversations.spec.ts` | Private conversations: reply without reload, append-only record, isolation by person and company, Viewer refused, restart and lost runs, Hermes unreachable. | 130.7 s | hermes-runs.test.mjs, unknown-starts.test.mjs (driver logic without a browser) | keep |
| `db.sh` | Database tests: RLS, grants and migrations replayed on legacy data (runs the *-migration.mjs and supabase/tests). | 20 s | — | keep |
| `deploy.test.mjs` | Database verification reads plain rows and agent envelopes and names every false key. | 2.7 s | — | keep |
| `design-compare.test.mjs` | The design comparison tool refuses any database but the seeded local one. | 0.6 s | — | keep |
| `design-reference.spec.ts` | The production build answers 404 for the design reference. | 0 s | design-reference.test.mjs (the files, not the route) | keep |
| `design-reference.test.mjs` | The design reference matches its approved checksums, file for file. | 0.3 s | design-reference.spec.ts | keep |
| `docs-only.test.mjs` | Only design, docs and Markdown changes skip the long CI stages. | 1.4 s | — | keep |
| `engine-agents.test.mjs` | An Agent is one Engine profile made through the management listener with the install key. | 0.7 s | hermes-agents.spec.ts | keep |
| `engine-conversation.spec.ts` | On the fake engine a reply is stored once with usage; failed and stopped runs end with usage; a Viewer is refused. | 28.1 s | conversations.spec.ts (the same flow on fake Hermes) | keep |
| `engine-name.spec.ts` | No page names the Engine, in English or Arabic. | 16 s | engine-name.test.mjs (catalogues only, not rendered pages) | keep |
| `engine-name.test.mjs` | No message value names the Engine, in any language. | 0.3 s | engine-name.spec.ts | keep |
| `engine.test.mjs` | The engine driver runs once per idempotency key and never sends a key over plain HTTP to a public address. | 0.6 s | — | keep |
| `fake-engine.mjs` | browser helper: an in-memory engine | — | — | helper, kept |
| `fake-hermes.mjs` | browser helper: a fake Hermes server | — | — | helper, kept |
| `first-run-db.test.mjs` | The first-run reset and seed restore run in fail-fast transactions. | 0.3 s | — | keep |
| `first-run-diagnostics.test.mjs` | First-run refusals log distinct causes; failing tests print only matching server lines. | 2 s | — | keep |
| `first-run-migration.mjs` | replays the first-run migration (tests/db.sh) | — | — | helper, kept |
| `first-run.spec.ts` | An empty install creates its first Owner and Company only through the setup link; wrong codes, short passwords and races create nothing; no password reaches a log. (first-run project, last) | 24 s | setup-code.test.mjs, first-run.test.mjs (route logic without a browser) | keep (decision #50) |
| `first-run.test.mjs` | First run accepts authored names and language and refuses invalid input before provisioning. | 0.4 s | first-run.spec.ts | keep |
| `flaky-tests.test.mjs` | A flaky test is named once, with its first failure. | 0.4 s | — | keep |
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
| `install-related.test.mjs` | A PR runs the install job only when it changes a file the install exercises. (new, #69) | 3.3 s | — | new |
| `install.test.mjs` | A failed update keeps the serving containers and prints its log. | 4.5 s | install job | keep (decision 0015) |
| `install/rate-limit.install.ts` | On a real install behind the HTTPS proxy, repeated wrong passwords hit the auth rate limit and the page says so. (install job) | in install job | sign-in-rate-limit.test.mjs (the page and logs without an install) | keep (decision 0015 install checks) |
| `lane.mjs` | browser helper: one whole stack per worker (new, #69) | — | — | helper, kept |
| `language.spec.ts` | English by default, the account language across sessions and devices, automatic content direction, and Arabic sign-in. | 62.6 s | — | keep (direction checks) |
| `lead-agent-migration.mjs` | replays the lead-agent migration (tests/db.sh) | — | — | helper, kept |
| `lessons.test.mjs` | A lesson is proposed only from a run; deciding is a person's action. | 0.3 s | skill-lessons.spec.ts | keep |
| `license.test.mjs` | LICENSE is MIT with the owner's copyright and the package stays private. | 0.6 s | — | keep |
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
| `playwright-journal.test.mjs` | A killed Playwright run still leaves a truthful record; `check` still needs a green integration job. | 107.1 s | — | keep |
| `playwright-projects.test.mjs` | Screens run first on the seed, functional next, first run last, and a failure in one group hides none of the others. | 77.8 s | — | keep |
| `projects.spec.ts` | Projects are created, cards filed into them, Viewers read only, and a later change by someone else is not overwritten. | 23.3 s | — | keep |
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
| `sidebar.test.mjs` | The Inbox entry stays named at zero; the account menu offers Light, Dark and Device. | 0.5 s | theme.spec.ts | keep |
| `sign-in-rate-limit.test.mjs` | The sign-in page says to try later on 429, and never logs the password. (#41) | 3.4 s | rate-limit.install.ts | keep |
| `sign-in.ts` | browser helper: sign in and read emailed links | — | — | helper, kept |
| `skill-lessons.spec.ts` | An agent proposes a lesson from its run; approving adds it to the skill and rejecting does not. | 37.5 s | lessons.test.mjs (route pieces) | keep |
| `skills.spec.ts` | A member installs and enables a skill for the Writer, a bad skill is refused, and the agent reads exactly its enabled skills. | 17.3 s | skills.test.mjs (the library) | keep |
| `skills.test.mjs` | Every library skill is valid and installs only from the stored catalogue. | 0.2 s | skills.spec.ts | keep |
| `split-catalogues.test.mjs` | Every key a split catalogue owner asks for exists in both languages. | 0.2 s | — | keep |
| `sql-statements.mjs` | helper: split SQL into statements | — | — | helper, kept |
| `tap-overlaps.spec.ts` | The tap-overlap measure used by the phone checks counts what really overlaps. | 0.3 s | — | keep |
| `tap-overlaps.ts` | browser helper: tap-area overlap measure | — | — | helper, kept |
| `team-work.spec.ts` | Queued turns run in order, lost answers are retried once, stop and roles are enforced, authors come from the session, notes stay private. | 85.6 s | unknown-starts.test.mjs, hermes-runs.test.mjs (driver logic) | keep |
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
| `visual.spec.ts` | Eighteen screens match their approved images in English and Arabic at 390 and 1440, light and dark, on the seed as built. (visual project, first) | 83.6 s | visual-baselines.test.mjs (every screen has its images) | keep |
| `visual.spec.ts-snapshots/` | The 72 approved screen images `visual.spec.ts` compares with. | — | — | data, kept |
