# gtmworks

A multi-company marketing operating system. gtmworks holds the work, approvals
and results; agents run in Hermes, which the install includes. English and Arabic are included.

## Install

On a Linux server, unpack this repository's source archive and, from that directory, run:

```sh
sh scripts/install.sh
```

Requirements: Docker Engine with Docker Compose v2.20+ (`docker compose`), POSIX
`sh`, internet access to pull images and npm packages, 2 CPU cores, **8 GB RAM**
(including the first image build), and **20 GB free disk**, plus room for your data.
No host Node.js, Git, Supabase CLI, cloud project or external account is required.
These are initial sizing recommendations, not measured capacity guarantees.

Open **http://localhost:3000/**. Port **3000** (app and Supabase gateway)
and **8025** (local email inbox) must be free; both bind **only to 127.0.0.1**.
For a remote server, forward them over SSH (`ssh -L 3000:localhost:3000
-L 8025:localhost:8025 your-server`) and open the local URL. Do not expose the
mailbox publicly. On a fresh install, enter your name, email and first company
name, then follow the sign-in link in the local inbox at http://localhost:8025.
You become the Agency owner and the first company's Owner. Setup then closes
permanently; later visits use sign-in. Public sign-ups stay disabled. No demo
people or companies are created, and no SMTP account is needed for the local inbox.

The command builds the web image and starts the web app, worker, Postgres,
GoTrue, PostgREST, file Storage, an Nginx gateway, the local mail inbox and the
Hermes agent engine, which is reachable only inside the install.
One install serves one company until each company gets its own agent engine home:
companies on the bundled agent engine share one agent memory, so an agent can
repeat facts from one company to people in another.
Realtime, Studio, analytics and edge functions are not installed. Service settings
follow the [official Supabase self-hosted stack](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml).

Secrets are generated on this machine in **`.env.install`**, with owner-only
permissions (600), ignored by Git and excluded from image builds. Never commit,
delete or regenerate this file for an existing database. `.env.install.example`
documents the keys but deliberately cannot start the app. Public HTTP is rejected;
HTTP is allowed only for this install's loopback origin. For a public deployment,
put HTTPS in front and set `APP_ORIGIN` and `SUPABASE_PUBLIC_URL` to that origin.

Run the same command again to resume an interrupted install or start it again.
It preserves secrets and data, and applies only unrecorded migrations, in filename
order, atomically under a database lock. Verification companions and demo seed data
are never applied. Migration history lives in `gtmworks_install.schema_migrations`.

Persistent data lives in Docker named volumes `gtmworks-install_database`
(Postgres), `gtmworks-install_database-config` (database encryption configuration),
`gtmworks-install_files` (Storage files) and `gtmworks-install_hermes` (agent
engine data), under Docker's data root (normally
`/var/lib/docker/volumes`). The local email inbox is temporary. Never use `down -v`
on live data.

## Update

From the install directory, run:

```sh
sh scripts/install.sh update                 # download latest main, migrate, rebuild and restart
```

Update accepts a GitHub tag or commit after `update` to select a version. It keeps
the existing volumes and `.env.install`. For private source, set `GH_TOKEN` to a
GitHub token with Contents read access; CI supplies its job token. If a migration
fails, the transaction is rolled back, the command exits non-zero naming the
migration, and the previous app keeps serving. Fix the migration or select a
corrected version and retry.

## Backup

```sh
sh scripts/install.sh backup                 # dated archive in backups/
```

Backup briefly stops the stack for a consistent copy of the first three volumes, then
starts it again. An optional directory after `backup` changes the destination.
**A backup holds every company's data and the encryption key. Keep it private.**
Archives have owner-only permissions (600); copy them to private storage on another
machine. The default `backups/` directory is excluded from Git and image builds.

## Restore

```sh
sh scripts/install.sh restore backups/gtmworks-<date>-<number>.tgz
```

Restore only accepts an empty install: run the install command from the same source
version as the backup first, then restore the trusted archive. It replaces that
empty install's volumes and `.env.install`, including its keys and origin settings,
and restarts the stack. This is a full-install backup, not a company export; it
does not back up the agent engine's data volume. Do not use it to change the pinned Postgres version.

## Releases

A tag `vX.Y.Z` publishes only a commit that is on `main` and whose required CI
check passed on its push to `main`; any other tag publishes nothing. Each such tag
publishes the image `ghcr.io/omarabdo516/gtmworks:X.Y.Z` for
`linux/amd64` and `linux/arm64`, and a GitHub Release with two files:
`docker-compose.install.yml`, which pins every image by digest, and `install.sh`.
In a directory holding only those two files, `sh install.sh` pulls the image and
takes the migrations and install files from it; nothing is built on the server.
`stable` and `latest` move only after a release's install passes on its exact image,
and always to the highest published release, so an older or hotfix tag never moves
them back; `main` follows the head of main once its CI passed. A release install
updates when both files are replaced with the next release's and `sh install.sh
update` runs; it applies the new migrations, then recreates every service whose
image changed. Back up before replacing them: backup and restore refuse to run with
the files of a release the install does not run yet, and after an update that did
not finish. If an update fails, the previous app keeps serving; put the previous
release's two files back and run `sh install.sh update` to return to it (migrations
already applied stay, as they move only forward).

The first push creates the package `ghcr.io/omarabdo516/gtmworks` **private**, and
nothing in the workflow can change that. Its owner makes it public once: on GitHub,
open the package's **Package settings**, choose **Change visibility** and set it to
**Public**. Until then a release's install test stops on its anonymous read, and
`stable`, `latest` and the GitHub Release are not published; afterwards, re-run that
workflow run's failed jobs.

## Licence

gtmworks is released under the MIT License. See [LICENSE](LICENSE).
