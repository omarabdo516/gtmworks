# gtmworks

A multi-company marketing operating system. gtmworks holds the work, approvals
and results; agents run in Hermes, which the install includes. English and Arabic are included.

## Install

On a Linux server with Docker, run:

```sh
curl -fsSL https://raw.githubusercontent.com/omarabdo516/gtmworks/main/scripts/get.sh | sh
```

It installs the latest stable release into `~/gtmworks`: it downloads that
release's two files (`docker-compose.install.yml` and `install.sh`) from its GitHub
Release, generates the secrets, pulls the images by digest and starts gtmworks.
Nothing is built on the server and no source is downloaded. Options go after
`sh -s --`, for example `... | sh -s -- --version v1.2.3`:

- `--version vX.Y.Z` installs that release instead of the latest.
- `--channel main` installs the newest build of `main`, which no release has
  tested yet. Main publishes no GitHub Release, so its two files are written from
  inside that image (`scripts/release-assets.mjs`) for the digest just pulled.
- `--dir <folder>` installs into another folder. One machine runs one install
  (its containers and volumes are all named `gtmworks-install`), so the line
  refuses a second folder while another one runs gtmworks, before changing anything.

It also puts a `gtmworks` command in `~/.local/bin`, and adds that folder to the
PATH in your shell profile only when no profile names it yet; open a new shell to
use it. `gtmworks status` reports each service's health; `gtmworks backup`,
`gtmworks restore` and `gtmworks update` are described below.

Before it changes anything, the line checks for Docker and Docker Compose v2.20+
and stops with a plain message naming what to install. Running the line again (or
`gtmworks install`) repairs and restarts the release the folder runs, keeping its
secrets and data; to move to another release or channel (`--channel stable` on a
`main` install included), use `gtmworks update`. A repair refuses a release older
than the data (see Update). In a folder whose release is not recorded (one installed
by hand from its two release files), the line checks the release against the data
first, and moving to another release is an update, backup first.

Requirements: Docker Engine with Docker Compose v2.20+ (`docker compose`), POSIX
`sh`, `curl`, internet access to pull images, 2 CPU cores, **8 GB RAM** and **20 GB
free disk**, plus room for your data. No host Node.js, Git, Supabase CLI, cloud
project or external account is required. These are initial sizing
recommendations, not measured capacity guarantees.

On a fresh install, the installer's last line is a one-time **setup link**:
`<APP_ORIGIN>/first-run#code=<code>` (http://localhost:3000 unless you set
`APP_ORIGIN`). The code is generated on this server and kept in `.env.install`.
It sits after `#`, a part of the address the browser keeps to itself, so no proxy
or server request log ever receives it; the page sends it only with the setup form.
first-run setup opens only through that link, so whoever runs the installer sets
the install up, not whoever reaches the address first. Lost it? Run the line
again: until setup is finished it prints the same link, and afterwards the
sign-in address instead.

Port **3000** (app and Supabase gateway)
and **8025** (local email inbox) must be free; both bind **only to 127.0.0.1**.
For a remote server, forward them over SSH (`ssh -L 3000:localhost:3000
-L 8025:localhost:8025 your-server`) and open the setup link there. Do not expose the
mailbox publicly. On a fresh install, enter your name, email, a password of at
least 10 characters (twice) and your first company name; you are signed in
at once, with no email step. You become the first company's
Owner. Setup then closes permanently and the setup link stops working; later
visits sign in with email and password, and a sign-in lasts 30 days on that
browser unless you sign out. Public sign-ups stay disabled. No demo people or
companies are created.
The local inbox at http://localhost:8025 receives password reset links and invitations.
No SMTP account is needed for it.

The install starts the web app, worker, Postgres,
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
Run that proxy on the install machine, pointed at `127.0.0.1:3000`, and have it put
each visitor's address in `X-Forwarded-For` (Caddy's `reverse_proxy` does this by
default; an Nginx `$proxy_add_x_forwarded_for` works too). The gateway reads the
last address in that header, so repeated wrong passwords are limited per visitor
rather than for everyone behind the proxy. It believes the header only from
connections that come from the install machine itself; a container on the install
network is never believed. Every process on the install machine is trusted to name
a visitor this way, so do not run untrusted programs on it. With no such header,
every visitor behind the proxy shares one sign-in allowance.

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

### From source

To run a source checkout instead (for development, or a version with no release),
unpack this repository's source archive on the server and, from that directory, run
`sh scripts/install.sh`. It builds the web image there (8 GB RAM including that
build, and internet access for npm packages) and otherwise installs as above. In a
source checkout, `sh scripts/install.sh update [tag or commit]` downloads that
source (latest `main` by default), migrates, rebuilds and restarts; for private
source set `GH_TOKEN` to a GitHub token with Contents read access. The `backup` and
`restore` below run as `sh scripts/install.sh backup` and `sh scripts/install.sh
restore <archive>` there.

## Update

```sh
gtmworks update                              # back up, then move to the latest stable release
gtmworks update --version v1.2.3             # or to that release
gtmworks update --channel stable             # a main install back to the latest stable release
```

Update backs up first and prints the archive's path (`--no-backup` skips it),
downloads the new release's two files, pulls its images by digest, applies its
migrations from inside the new image and recreates the containers whose image
changed. It keeps the existing volumes and `.env.install`, downloads no source,
and every file in the install folder stays owned by you. Its last line is the
exact command that goes back to the release you ran before:
`gtmworks update --version <previous>` when the update applied no migration, or,
when it did, `gtmworks restore <archive> --version <previous>`. Before it changes
anything, that command checks the archive as restore does (only a backup's own
entries, each of them present) and refuses an archive whose database applied a
migration `<previous>` does not carry; then it names what it replaces and asks you
to type `yes` (`--yes` answers for a script). It then backs up the current data,
makes the install anew with that release, restores the archive and applies that
release's migrations the archive predates (the agent engine's volume is kept).

It refuses a release older than the data: when the database has applied a
migration the chosen release does not carry, a later release migrated it, and
the update stops with a plain message before changing anything. Going back past
a migration is a restore of a backup made before it. If a migration fails, the
transaction is rolled back, the previous release's files are put back and it keeps
serving, and the command exits non-zero naming the migration. If the update fails
after its migrations ran (while starting the new containers, say), the install
stays on the new release: `gtmworks install` finishes it. An install on the
`main` channel updates to the newest main build. `gtmworks update` does not replace
the `gtmworks` command itself; run the line again for a newer one.

## Backup

```sh
gtmworks backup                              # dated archive in backups/
```

Backup briefly stops the stack for a consistent copy of the first three volumes, then
starts it again. An optional directory after `backup` changes the destination.
**A backup holds every company's data and the encryption key. Keep it private.**
Archives have owner-only permissions (600); copy them to private storage on another
machine. The default `backups/` directory is excluded from Git and image builds.

## Restore

```sh
gtmworks restore backups/gtmworks-<date>-<number>.tgz
```

Restore only accepts an empty install: install the same release as the backup
first, then restore the trusted archive (or, on a running install, use
`gtmworks restore <archive> --version vX.Y.Z` as Update describes). It replaces that
empty install's volumes and `.env.install`, including its keys and origin settings,
and restarts the stack. This is a full-install backup, not a company export; it
does not back up the agent engine's data volume. Do not use it to change the pinned Postgres version.
A relative archive path the current folder does not hold is read from the install
folder, so `gtmworks restore backups/<name>` works from any folder.

## Releases

A tag `vX.Y.Z` publishes only a commit that is on `main` and whose required CI
check passed on its push to `main`; any other tag publishes nothing through this
release workflow. A collaborator with write access can still run workflows of their
own from any commit they push, and publish with them: only repository access and
rules on tags and branches limit that, not a workflow file. The repository's active
tag ruleset `release tags: admins only` lets only repository admins create, move or
delete a `v*` tag; the release workflow relies on that rule and adds no credential
of its own. Each such tag
publishes the image `ghcr.io/omarabdo516/gtmworks:X.Y.Z` for
`linux/amd64` and `linux/arm64`, and a GitHub Release with two files:
`docker-compose.install.yml`, which pins every image by digest, and `install.sh`.
Published releases are immutable (the repository's immutable releases setting):
once a release is published its two files can never be replaced. So the workflow
uploads both files to a draft release, checks the draft holds exactly the files
the install test passed on, and only then publishes it. A re-run of a tag whose
release is already published leaves that release as it is and neither rebuilds
nor re-tags its image `X.Y.Z`; it only runs the promotion of `stable` and
`latest`. A fix ships as a new release `vX.Y.Z`. In a directory holding only those two files, `sh install.sh` pulls the image and
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
already applied stay, as they move only forward). The one line and `gtmworks update`
take the latest stable release to be the highest published `vX.Y.Z`, the one
`stable` names, read from every page of the GitHub Releases list, and download
its two files from that release. CI points both at local test releases instead with the test-only
`GTMWORKS_RELEASES` (a base URL holding `releases.json` and `<tag>/<file>`) and
`GTMWORKS_GET` (where the piped script copies itself from); `scripts/get.sh`
describes them.

The first push creates the package `ghcr.io/omarabdo516/gtmworks` **private**, and
nothing in the workflow can change that. Its owner makes it public once: on GitHub,
open the package's **Package settings**, choose **Change visibility** and set it to
**Public**. Until then a release's install test stops on its anonymous read, and
`stable`, `latest` and the GitHub Release are not published; afterwards, re-run that
workflow run's failed jobs.

## Licence

gtmworks is released under the MIT License. See [LICENSE](LICENSE).
