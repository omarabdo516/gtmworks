# Bring the app up and use it, in a cloud session

Every Claude Code cloud session that builds a ticket brings the whole app up inside its VM and uses it as a person
would before it pushes (Omar, 2026-11-21; #485). The repo owns every step, so it works on any Claude account with no
setup of the account's own. Only the local stack's credentials are used: no production key, no outside call.

## What already happened when the session started

`.claude/settings.json` runs `scripts/cloud-session-setup.sh` at every session start. Outside a cloud session
(`CLAUDE_CODE_REMOTE` is not `true`) it does nothing. In one it starts `dockerd` in the background when no Docker daemon
answers (first removing any pid file left from before the VM restarted, see "When it does not start"), and runs `npm ci`
when `package-lock.json` changed since the last install (or `node_modules` is missing). It prints one line when it is
done, after a `Removing the stale …` line for each pid file it removed.

## 1. Bring it up: `npm run cloud:up`

One command, about a minute and a half on a warm VM:

1. waits for Docker (starting `dockerd` if the hook's start has not answered yet), installs dependencies if needed, and
   installs Chromium when the build this checkout's Playwright pins is not on the machine;
2. stops whatever an earlier `cloud:up` started;
3. rebuilds the local Supabase stack with its migrations and seed (`scripts/local-db.sh`);
4. starts the fake Engine (`scripts/cloud-hermes.mjs`, the browser suite's fake Hermes) where the app looks for the
   bundled one, so a message to an Agent gets the reply `Reply to: <message>`;
5. starts the app and its worker (`scripts/web.sh`, `next dev` on port 3000) in the background and waits until it answers;
6. signs the seeded Administrator in with Chromium (`node scripts/cloud-verify.mjs --sign-in`) and prints the page it reached.

It ends by printing:

- the app: `http://127.0.0.1:3000`;
- the seeded Administrator: `omar@example.com` / `local-seed-password` (every seeded person in `supabase/seed.sql` has that
  password: `manager@`, `reviewer@`, `viewer@`, `multi@example.com`);
- the local database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`;
- the local inbox, where sign-in and invite emails land: `http://127.0.0.1:54324`;
- the sign-in screenshot: `$TMPDIR/gtmworks-cloud/screens/cloud-verify-signed-in.png`;
- the logs: `$TMPDIR/gtmworks-cloud/web.log` and `hermes.log` (`/tmp/gtmworks-cloud/` when `TMPDIR` is unset).

`npm run cloud:up -- --fresh` does the same on an empty install (no people, no Company) and prints the first-run setup
link instead of a seeded user. `npm run cloud:down` stops the app, the fake Engine and the stack (its volumes stay).
Running `cloud:up` again starts over from a freshly seeded database.

Its files live outside the checkout on purpose: `next dev` watches every file in the repo, and a log written there
makes it recompile without end.

## 2. Walk the journey: `npm run cloud:verify`

With the app up, this walks the product's main journey in Chromium, driven by Playwright, and checks each step on the
page and in the local database:

1. empties the install, then walks first run from the setup link: creates the Administrator and the first Company, and checks
   both in `public.companies` and `public.members` (role `owner`);
2. signs out, signs back in with that email and password, answers "Alone" and lands in a Conversation with Lead;
3. sends Lead a message and sees the reply on the page, then reads both messages in `public.conversation_messages`;
4. opens Numbers (the KPI dashboard) from the sidebar;
5. puts the seed back, signs in as `omar@example.com`, opens RS Learning's Marketing board from the sidebar and finds,
   in In progress with its "Working on it now" symbol, the Card the fake Engine holds (`scripts/cloud-hermes.mjs`): the
   board is the Company's Engine's own Kanban board (spec #831), read through gtmworks.

Screenshots of every step (`cloud-verify-NN-<step>.png`) go to `$TMPDIR/gtmworks-cloud/screens` (`--out DIR` puts them elsewhere); attach the ones
that show your change to the pull request. The journey always ends with the seed back, its own Owner and Company gone too, also when a step
fails; a failure leaves a `cloud-verify-NN-failed.png` beside the others. It refuses any app or database but the local stack's.

## 3. Walk your own change

The journey is the floor, not the ceiling. For a change a person can see or touch, sign in as the seeded person whose
role the change concerns and click through it yourself, the same way: with Playwright driving Chromium against
`http://127.0.0.1:3000`, typing and submitting as a person would, then reading the result on the page and in the
database (`npx supabase db query "<sql>" -o json --agent no`). `scripts/cloud-verify.mjs` is a starting point to copy
from. Any email goes to the local inbox; a test that must name an outside address uses `delivered@resend.dev`.

## The image and integration jobs

`./ci.sh integration` (the browser suite; `--shard=1/6` for one of CI's shards) and `bash scripts/ci-image.sh` (the
`image` job's build and health check) run in a cloud session as they do on CI's runner, with the stack from step 1 up.
Every app image build goes through `scripts/docker-build.sh` (#562): the session's network re-signs every TLS connection
with its own CA, which the VM's Node trusts through `NODE_EXTRA_CA_CERTS` and a container does not, so the helper hands
that file to the build as the BuildKit secret `build-ca`, and the Dockerfile's npm steps trust it only while they run.
Nothing of it reaches the image, and where the variable names no file (CI, a release) it is the plain `docker build`. A
build you type yourself does the same with `bash scripts/docker-build.sh -t gtmworks:ci .`. `./ci.sh install <area>`
builds the app image on the VM the same way and loads it into its isolated machine, as CI's install jobs load the image
job's build, and that machine's Docker trusts the same CA for the pulls it makes; the areas that update from a fixed older commit (`update`, `previous-archive`, `sandbox-update`,
`staged-update`) build that commit's own Dockerfile, which takes the CA only once the commit is one made after #562. The work sandbox check needs `ssh-keygen`, which CI's runner has
and a cloud VM may not: `apt-get install -y openssh-client` first. Docker needs no proxy setting
here: the network reaches containers directly (plain HTTP, such as the sandbox image's `apt-get`, works as it is), and
the session proxy at `127.0.0.1` would be the container's own loopback.

## When it does not start

- `the Docker daemon did not answer within 90 seconds`: read `$TMPDIR/gtmworks-dockerd.log`.
- A stale pid file (#522): a restored VM keeps `/var/run/docker/containerd/containerd.pid` and `/var/run/docker.pid`
  from before it stopped, and their pid can belong to another process by now, so dockerd logs `containerd is still
  running`, then `failed to start containerd: timeout` (or `process with PID … is still running` for `docker.pid`).
  Every start (the hook's and `cloud:up`'s) removes a pid file whose pid is not a running `containerd` or `dockerd`, and
  containerd's sockets beside it, and prints `Removing the stale …`; a pid file of a daemon that really runs stays. By
  hand: `rm /var/run/docker/containerd/containerd.pid /var/run/docker.pid`, then `cloud:up` again.
- `port 3000 is taken by a process cloud:up did not start`: an app you started by hand (`npm run dev`) is still
  running; stop it and run `cloud:up` again.
- The stack fails to start: the last lines of `$TMPDIR/gtmworks-local-db.log` are printed; `npx supabase stop
  --project-id repo` then `cloud:up` again clears a half-started stack.
- The app stops while starting: the last lines of its log are printed.
