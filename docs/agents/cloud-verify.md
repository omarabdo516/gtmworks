# Bring the app up and use it, in a cloud session

Every Claude Code cloud session that builds a ticket brings the whole app up inside its VM and uses it as a person
would before it pushes (Omar, 2026-11-21; #485). The repo owns every step, so it works on any Claude account with no
setup of the account's own. Only the local stack's credentials are used: no production key, no outside call.

## What already happened when the session started

`.claude/settings.json` runs `scripts/cloud-session-setup.sh` at every session start. Outside a cloud session
(`CLAUDE_CODE_REMOTE` is not `true`) it does nothing. In one it starts `dockerd` in the background when no Docker daemon
answers, and runs `npm ci` when `package-lock.json` changed since the last install (or `node_modules` is missing). It
prints one line when it is done.

## 1. Bring it up: `npm run cloud:up`

One command, about a minute and a half on a warm VM:

1. waits for Docker (starting `dockerd` if the hook's start has not answered yet) and installs dependencies if needed;
2. stops whatever an earlier `cloud:up` started;
3. rebuilds the local Supabase stack with its migrations and seed (`scripts/local-db.sh`);
4. starts the fake Engine (`scripts/cloud-hermes.mjs`, the browser suite's fake Hermes) where the app looks for the
   bundled one, so a message to an Agent gets the reply `Reply to: <message>`;
5. starts the app and its worker (`scripts/web.sh`, `next dev` on port 3000) in the background and waits until it answers;
6. signs the seeded Owner in with Chromium (`node scripts/cloud-verify.mjs --sign-in`) and prints the page it reached.

It ends by printing:

- the app: `http://127.0.0.1:3000`;
- the seeded Owner: `omar@example.com` / `local-seed-password` (every seeded person in `supabase/seed.sql` has that
  password: `manager@`, `reviewer@`, `viewer@`, `multi@example.com`);
- the local database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`;
- the local inbox, where sign-in and invite emails land: `http://127.0.0.1:54324`;
- the logs: `$TMPDIR/gtmworks-cloud/web.log` and `hermes.log` (`/tmp/gtmworks-cloud/` when `TMPDIR` is unset).

`npm run cloud:up -- --fresh` does the same on an empty install (no people, no Company) and prints the first-run setup
link instead of a seeded user. `npm run cloud:down` stops the app, the fake Engine and the stack (its volumes stay).
Running `cloud:up` again starts over from a freshly seeded database.

Its files live outside the checkout on purpose: `next dev` watches every file in the repo, and a log written there
makes it recompile without end.

## 2. Walk the journey: `npm run cloud:verify`

With the app up, this walks the product's main journey in Chromium, driven by Playwright, and checks each step on the
page and in the local database:

1. empties the install, then walks first run from the setup link: creates the Owner and the first Company, and checks
   both in `public.companies` and `public.members` (role `owner`);
2. signs out, signs back in with that email and password, answers "Alone" and lands in a Conversation with Lead;
3. sends Lead a message and sees the reply on the page, then reads both messages in `public.conversation_messages`;
4. opens Numbers (the KPI dashboard) from the sidebar;
5. puts the seed back, signs in as `omar@example.com`, makes a Card on RS Learning's Marketing board and drags it from
   Ideas to Planned, then checks the Card's stage in `public.work_cards` (a new Company has only Lead, and a Card needs
   another Agent).

Screenshots of every step go to `$TMPDIR/gtmworks-cloud/screens` (`--out DIR` puts them elsewhere); attach the ones
that show your change to the pull request. The journey always ends with the seed back, also when a step fails, and its
failure leaves a `NN-failed.png` beside the others. It refuses any app or database but the local stack's.

## 3. Walk your own change

The journey is the floor, not the ceiling. For a change a person can see or touch, sign in as the seeded person whose
role the change concerns and click through it yourself, the same way: with Playwright driving Chromium against
`http://127.0.0.1:3000`, typing and submitting as a person would, then reading the result on the page and in the
database (`npx supabase db query "<sql>" -o json --agent no`). `scripts/cloud-verify.mjs` is a starting point to copy
from. Any email goes to the local inbox; a test that must name an outside address uses `delivered@resend.dev`.

## When it does not start

- `the Docker daemon did not answer within 90 seconds`: read `$TMPDIR/gtmworks-dockerd.log`.
- `port 3000 is taken by a process cloud:up did not start`: an app you started by hand (`npm run dev`) is still
  running; stop it and run `cloud:up` again.
- The stack fails to start: the last lines of `$TMPDIR/gtmworks-local-db.log` are printed; `npx supabase stop
  --project-id repo` then `cloud:up` again clears a half-started stack.
- The app stops while starting: the last lines of its log are printed.
