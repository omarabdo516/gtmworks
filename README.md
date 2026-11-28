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
  It also refuses a folder without the keys of gtmworks data Docker still holds
  (containers removed, volumes kept), and names the folder that made it: each
  install keeps the creation time of its data volume (`.gtmworks-data`), so an old
  folder whose data another install has since made anew is refused too.

It also puts a `gtmworks` command in `~/.local/bin`, and adds that folder to the
PATH in your shell profile only when no profile names it yet (`~/.profile`, and
`~/.zshenv` when your login shell is zsh, which reads no other); open a new shell
to use it. `gtmworks status` reports each service's health and every
Company's Engine; `gtmworks backup`, `gtmworks restore` and `gtmworks update` are
described below.

Before it changes anything, the line checks for Docker and Docker Compose v2.20+
and stops with a plain message naming what to install. Running the line again (or
`gtmworks install`) repairs and restarts the release the folder runs, keeping its
secrets and data; to move to another release or channel (`--channel stable` on a
`main` install included), use `gtmworks update`. A repair refuses a release older
than the data (see Update). In a folder whose release is not recorded (one installed
by hand from its two release files), the line checks the release against the data
first, and moving to another release is an update, backup first.

Requirements: Docker Engine with Docker Compose v2.20+ (`docker compose`), POSIX
`sh`, `curl`, `flock` (from util-linux, present on nearly every Linux install),
internet access to pull images, **20 GB free disk** plus room for your data (each
Company's work disk takes up to its limit, 10 GB by default, as it fills), and
the CPU and RAM of one of the two server sizes below. No host Node.js, Git,
Supabase CLI, cloud project or external account is required.

**Server size.** Two sizes, from the install job's measurement (`install-sizes`,
run 44848354569, which prints these numbers on every run) and the Company's Screen
measured on the pinned Engine (#711):

- **Without video: 2 CPU cores and 4 GB RAM.** Idle, the install's own services
  (web app, worker, Postgres, sign-in, REST, Storage and gateway) use
  493 MiB, the first Company's idle Engine 466 MiB and its idle work sandbox 1 MiB: about
  1 GB for one Company, which leaves room for the system, an Engine at work, the
  Company's Screen awake and a few more Companies.
- **With video: 4 CPU cores and 8 GB RAM.** One short render (60 frames of
  1280x720 drawn by Chromium and joined by ffmpeg into a two-second video) took
  13.7 s and peaked at 337 MiB in its sandbox. A sandbox may use up to its limit,
  **2 GB of RAM and 2 CPUs** by default, so each Company rendering at the same time
  needs up to 2 GB and 2 cores more than the size without video.
- **A Company's Screen** is one desktop and browser its Agents share (one awake
  per Company, with one browser profile, so a sign-in on it serves every Agent).
  It costs nothing asleep. Awake, its desktop (Xvnc and Xfce at 1440x900) holds
  about 100 MiB of the Company's sandbox, and 400 to 690 MiB with one page open in
  its browser (a Wikipedia article 405 MiB, YouTube 588 MiB, the Google Ads page
  545 to 687 MiB), peaking at **831 MiB**; the driver `computer_use` runs there adds
  26 MiB. It sleeps after 30 minutes unused. The default sandbox limit of 2 GB holds
  the Screen awake with such a page beside a render, or beside the Agents' own
  commands and code.
- **Each added Company** costs its Engine, 466 MiB idle with its main Agent (the
  same `install-sizes` run; an Engine holding twenty more Agent profiles is measured
  apart, see below), its sandbox, 1 MiB idle and up to its 2 GB limit while it
  works, and its internet exit, a small proxy held to 256 MiB.

The limits are the install's defaults, set in one place (the sandbox service of
`scripts/engine-template.yml`), and the install job runs the render at them on every
run. A Company can have its own: `gtmworks company add --memory 2g --cpus 1.5` gives
the new Company's sandbox those, and `gtmworks company limits "Second Company"
--memory 3g` (or `--cpus 3`, or both) changes an existing Company's, the first one's
included. Memory is a whole number of megabytes or gigabytes (`512m`, `2g`) and CPUs a
number above 0 (`1`, `1.5`); a limit not named keeps its value. `company limits`
starts only that Company's sandbox again, with its work folder kept, while its Engine
and every other Company keep running; if the sandbox does not start with the new
limits (more CPUs than the server has, say), it starts again with the earlier ones and
the command says so. A Company's limits are kept with its own files beside its
Engine's key, so an update, a backup and restore and a repeat install give its sandbox
the same limits; a Company given none follows the install's default. The update that
raised the default to 2 GB (for the Company's Screen) raises a Company's own lower
memory limit to it once and never lowers one; a limit you set after that is kept. A render that needs more memory than its Company's limit is stopped at the
limit, and every other Company's sandbox keeps answering: one Company's video cannot
starve the others.

**Each Company's disk.** A work sandbox writes to nothing of the server's own disk:
its root is read-only, its scratch folders (`/tmp`, 1 GB, and `/var/tmp`, 256 MB) are
memory counted in its memory limit, and its work folder and home (the Screen's
browser profile with its sign-ins, the tools' settings and caches) are on the
Company's own work disk, a filesystem of a fixed size and number of files kept as one
image file under `.work-disks/` in the install's folder. Each Company gets a work disk
of **10 GB** by default; the image grows on the server's disk only as the Company
writes. A command that fills it stops with "No space left on device", and the database,
the app and every other Company keep running. `gtmworks company add --disk 20g` gives
a new Company another size and `gtmworks company limits "Second Company" --disk 20g`
changes one (a whole number of megabytes or gigabytes, at least `1g`): that Company's
Engine and sandbox stop for the moment the disk is resized, with its files kept. A size
below what the disk holds is refused, the command says how much it holds, and the
disk stays as it was. The limits of all Companies together may be more than the
server's disk, so size the server for what your Companies write. Making and mounting
a disk takes a short-lived privileged container from the work sandbox image, with no
network, that exits once the disk is ready (ADR 0032). After the server restarts, each
Company's Engine and sandbox start once the gtmworks updater (which runs every minute,
see Update) has mounted its disk, within a minute; on a machine without the updater,
run `gtmworks install`. An update from a release before the work disks moves each
Company's work folder onto its disk, with a disk large enough to hold it.

**The sandbox shares the server's kernel.** A work sandbox is a container, not a
virtual machine: every Company's sandbox, the Engines and the install run on the
one Linux kernel of the server. What holds a sandbox in is Docker: an ordinary user,
no capabilities, no new privileges, a network of its own and its memory, CPU and
process limits. So a flaw in the Linux kernel or in Docker that lets a process leave
its container would let a command an Agent runs (and so a Member, or a web page that
steers the Agent) reach the server and every Company on it. Keep the server's kernel
and Docker updated, run nothing else of value on it, and give a client whose work
must not share a kernel with another's a server of its own.

On a fresh install, the installer's last line is a one-time **setup link**:
`<APP_ORIGIN>/first-run#code=<code>` (http://localhost:3000 unless you set
`APP_ORIGIN`). The code is generated on this server and kept in `.env.install`.
It sits after `#`, a part of the address the browser keeps to itself, so no proxy
or server request log ever receives it; the page sends it only with the setup form.
first-run setup opens only through that link, so whoever runs the installer sets
the install up, not whoever reaches the address first. Lost it? Run the line
again: until setup is finished it prints the same link, and afterwards the
sign-in address instead.

Port **3000** (app and Supabase gateway) must be free; it binds **only to
127.0.0.1**. For a remote server, forward it over SSH
(`ssh -L 3000:localhost:3000 your-server`) and open the setup link there. On a
fresh install, enter your name, email, a password of at least 10 characters
(twice) and your first company name; you are signed in at once, with no email
step. You become the first company's Administrator. Setup then closes
permanently and the setup link stops working; later visits sign in with email
and password, and a sign-in lasts 30 days on that browser unless you sign out.
Public sign-ups stay disabled. No demo people or companies are created. People
join by Invite link, and a forgotten password is a password link an
Administrator or a Manager makes from the Team page.

The install starts the web app, worker, Postgres,
GoTrue, PostgREST, file Storage, an Nginx gateway and the first Company's
Engine. gtmworks makes that Engine from a fixed template shipped
with the release: the official Hermes image, pinned by tag and digest and kept
unmodified, with its own data volume, its own generated key and its own network.
The app and the worker join the Engine's network; the Engine joins nothing else,
so it cannot reach the database, the sign-in service, REST, Storage or another
Engine. No container of the install mounts the server's Docker socket. The
installer names every Company's Engine network for the app and the worker in
`docker-compose.engines.yml`, beside `docker-compose.install.yml` in the install
folder, and writes it again before each Compose command it runs; a Compose
command of your own that recreates them keeps them on those networks when it
reads both files: `docker compose --env-file .env.install -f
docker-compose.install.yml -f docker-compose.engines.yml up -d web worker`. An
Engine counts as healthy only while both its Run API and its management listener
answer.

**The work sandbox image (ADR 0020).** Every Company's work sandbox runs it: one image,
built on the Engine's own sandbox image with ffmpeg, Chromium, Node, Python and the
Arabic fonts added and an ordinary user to work as. A release pins it by tag and digest
and the install pulls it, so a release install builds nothing; a source checkout builds
it from `sandbox/Dockerfile`. It takes about **3.26 GB** on disk, with no Open Design since #911 (the install job prints
the measured size on every run). A Company's work folder is a volume, not a copy of the
image, so the image is fetched once for the whole install.

**One Engine per Company (ADR 0018).** Every Company runs on its own Engine, so one
Company's Agents, memory, Skills, Conversations and model sign-in stay in its own
container and are not reachable from another Company's Engine. The installer makes
the first Company's Engine; a later Company gets its own Engine from the same
template when the install owner adds it on the server:

```sh
gtmworks company add --name "Second Company" --owner person@example.com
gtmworks company add --name "Third Company"     # prints a first-Administrator link instead
gtmworks company list
```

`--owner` names a Person who already has an account on this install; an email that
belongs to no Person is refused before anything is made. With no `--owner`, the
Company's name waits behind a first-Administrator link that the command prints once: whoever
opens it types their name, email and password, becomes that Company's Administrator and lands
in it signed in. Its secret sits after `#` in the address, so only its hash is kept,
it works once, and opening the page without sending the form leaves it open. A lost
link is replaced with `gtmworks company link "Third Company"`, which ends the earlier
one. Until the link is used the Company exists nowhere, and `gtmworks company list`
shows it waiting for its first Administrator. `company add` makes the Engine, waits until it is
healthy, registers it and then makes the Company with that Person as its Administrator, or
holds the name behind the link; the worker then gives the Company its main Agent on
its own Engine. If the Engine does not become healthy the command says so in one line,
removes what it made (its container, volume, network and folder, and its record), and
leaves no Company, so running it again is safe. The Company's work sandbox and exit
are made with its Engine, with the memory, CPU and disk limit `--memory`, `--cpus` and
`--disk` name (the install's default with none), and the Engine must reach the sandbox before the
command says anything; a sandbox that does not start or cannot be reached is removed
the same way, with its work folder and its keys. `gtmworks company list` shows every
Company with the state of its Engine and of its work sandbox, and `gtmworks status`
reports every Engine and every sandbox.
Each Engine adds roughly the memory one Engine takes. The install job prints the memory one idle Engine uses on every run
(`install-sizes`): 466 MiB with its main Agent, as Server size states. An Engine that holds many Agent profiles takes more: the `install-measure`
job's Engine held 825 MiB with twenty of them (below), so size the server for that much per Company with many Agents.

**Agent profiles and isolation (ADR 0014).** Inside its Engine a Company keeps the
shape gtmworks has: the worker gives the Company its own profile (`co-<company
id>`), with its own memory, skills and sessions, and attaches the Company's agents
to it; each other agent gets its own `ag-` profile once it moves there, and a
Company's shared space is `cs-<company id>`. Every Agent gets one fixed set of
tools (ADR 0018): web, vision, image generation, skills, a task list, memory,
session search, the question tool and scheduled work. The work sandbox's terminal,
files and code, and the Agent's tools as a whole, are set out in Settings, Company.
Every Agent also gets `computer_use` on its Company's Screen: one desktop and
browser the Engine places inside the Company's work sandbox and the Company's
Agents share, sign-ins included, which starts by itself when an Agent needs it and
sleeps after the Engine's idle time (30 minutes). `browser` and
the desktop and project tools stay off for every Agent, so a member cannot ask an
agent to read another Company's data. An install
was proven with four Agents across two
Companies, and twenty more Agent profiles for capacity: each of the 20 took 0.66 to
1.04 seconds to be ready, the Engine held 775 MiB before and 825 MiB after making
them, and one profile takes 5136 KiB of disk with the Engine's bundled Skills and
1727 KiB without. Those twenty-profile figures come from the `install-measure` job's log, which runs on a push to
`main` and on a manual run only, never on a pull request (#408), and prints them in its line `capacity: …`. Settings,
Company says in one line what every Agent can use and that anything published or spent still waits for a person's
Approval.
Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory. A company still on the shared default profile from an earlier install shares that memory with the other agents of the same Company only: every profile lives in that Company's own Engine, and no other Company's Engine, Agents or people can read it.

The Administrator connects a subscription in Settings, Providers: ChatGPT
signs in from that page. A Company's subscription is signed in once on its own
Engine's root profile, and every Agent of that Company uses it. Another
Company's Engine and its Agents never see it. One account serves one Company, so
each Company signs in with its own account or sets its own API key. Claude signs in
only from the install's command line, with the command shown there, run from this
folder:
`gtmworks sign-in claude --company "<Company id or name>"`.
A Company's API key lives in its own Engine only: gtmworks passes it to that Company's Engine, never to another Company's, and never keeps, logs or shows it.
An install updated from before ADR 0014 keeps a Company's agents on the shared
`default` profile until its own profile holds a sign-in; the worker then moves it
there. Memory already written on `default` stays there, and earlier conversations
do not carry their Engine context to the new profile.
A backup includes every Company's Engine: each Company's Agents' profiles, rules
and memory, its skills, the Company knowledge, and its conversations' history. A
backup made before this was included holds none of it; restoring one says so in a
line, and the worker makes the profiles again, empty, so the Companies sign in
again.
Realtime, Studio, analytics and edge functions are not installed. Service settings
follow the [official Supabase self-hosted stack](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml).

Secrets are generated on this machine in **`.env.install`**, with owner-only
permissions (600), ignored by Git and excluded from image builds. Never commit,
delete or regenerate this file for an existing database; each Engine's key is kept
apart, in that Engine's own `.engines/<name>/.env` (600). `.env.install.example`
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
`gtmworks-install_files` (Storage files) and `gtmworks-install_hermes` (the first
Company's Engine data); each later Company's Engine keeps its own
`gtmworks-engine-<name>` volume, under Docker's data root (normally
`/var/lib/docker/volumes`). Never use `down -v`
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

## Companies

```sh
gtmworks company add --name "Second Company" --owner person@example.com
gtmworks company add --name "Third Company"     # prints a first-Administrator link instead
gtmworks company add --name "Video Company" --owner person@example.com --memory 2g --cpus 1.5 --disk 20g
gtmworks company limits "Second Company" --memory 3g --cpus 3 --disk 30g   # its work sandbox's limits
gtmworks company link "Third Company"          # a fresh link for a Company still waiting
gtmworks company list
```

`company add` makes the Company's own Engine from the same template, waits until it is
healthy, and makes the Company with that existing Person as its Administrator; with no
`--owner` it prints a first-Administrator link instead and makes the Company when that link is
sent. `company link` prints a fresh link for a Company still waiting and ends the
earlier one. A failed Engine leaves nothing behind and the same command can be run
again. `company limits` changes a Company's work sandbox memory, CPUs and disk and starts
only that sandbox again, and its Engine too when the disk changes (see **Server size**
and **Each Company's disk** under Install). `company list` shows
every Company with the state of its Engine, including one still waiting for its
Administrator, and each Company's work sandbox and its state. `gtmworks status` reports every
Engine and every sandbox beside the services. See **One Engine per Company** under Install for what each Engine holds and
how much memory it adds.

## Update

```sh
gtmworks update                              # back up, then move to the latest stable release
gtmworks update --version v1.2.3             # or to that release
gtmworks update --channel stable             # a main install back to the latest stable release
```

Administrators can also update from the app: **Update now** asks the install's updater, a
small timer the install puts on the server (a systemd user timer, or cron), which
runs `gtmworks update` within a minute and shows "Updated to <version>", or that
the update failed and which version still runs (ADR 0020). The app never reaches
Docker and never names the version: the updater always takes the newest of the
install's channel.

```sh
gtmworks update-button off                   # hide Update now; the updater ignores requests (on by default)
gtmworks auto-update on                      # install each newer version by itself, once an hour at most (off by default)
gtmworks status                              # shows both switches and how the updater runs
```

Update backs up first and prints the archive's path (`--no-backup` skips it),
downloads the new release's two files, pulls its images by digest, applies its
migrations from inside the new image and recreates the containers whose image
changed — every Company's Engine included: an Engine whose image the release
changed is recreated from the new release's Engine template with its own data
volume, its key and its network, so no Company is left on an old Engine. It keeps
the existing volumes and `.env.install`, downloads no source,
and every file in the install folder stays owned by you. Its last line is the
exact command that goes back to the release you ran before:
`gtmworks update --version <previous>` when the update applied no migration, or,
when it did, `gtmworks restore <archive> --version <previous>`. Before it changes
anything, that command checks the archive as restore does (only a backup's own
entries, each of them present) and refuses an archive whose database applied a
migration `<previous>` does not carry, or whose `.env.install` that release's own
check refuses; then it names what it replaces and asks you
to type `yes` (`--yes` answers for a script). It then backs up the current data,
makes the install anew with that release, restores the archive and applies that
release's migrations the archive predates (every Engine's data, now in the
archive, goes back with it).

An install made before each Company had its own Engine has every Company on the
one Engine, and this release has no way to give each of them one. With one
Company the update keeps that Company's Engine — its data volume and its key,
with its Agents, their memory, Skills, history, sessions and sign-in — now under
the Engine's own Compose project on a network of its own, with the key moved from
`.env.install` to `.engines/first/.env`, the only place an Engine key is kept.
With more than one Company the update stops before it changes anything: each
Company now needs its own Engine, there is no path for such an install in this
release, no migration is applied, no container is changed, and the release you
run keeps serving. Running the install command again on an updated install keeps
the Engine it adopted.

An install made before the work sandbox gets one for each Company it has, one
or many, from the update: the Company's sandbox, its exit and its work folder,
made beside its Engine as `company add` makes them. Each Engine is recreated on
its own data volume and pinned to its Company's sandbox, so every Agent's
terminal, files and code run there, and the worker brings every Agent, those
made before the update included, to the one fixed set of tools. Agents, their
memory, Skills, history and the Company's sign-in are kept, and so are the files
each Agent made: the update copies the files of the Agent's old Library folder
(`workspace` in its profile, on the Engine's disk) once into the Agent's own
folder of its Company's work folder, never over a file already there and never
into another Agent's or another Company's folder, and leaves the originals on the
Engine as they were. The Company's Agent
level is gone, and its past level changes still read in the Company's log. The
sandbox image is pulled before any migration, so an update whose image cannot be
pulled, like one whose migration fails, leaves the release you ran serving with no
migration applied and no sandbox begun. A sandbox that fails after the migrations
ran (one that does not start, say) leaves the install on the new release, as any
failure after the migrations does: `gtmworks install` finishes the update. Running
the install command again on an updated install keeps every sandbox and its work
folder, and copies no old file again.

When a release pins another work sandbox image, the update pulls it and makes every
Company's sandbox and exit again from it. Each Company's work folder is a volume of
its own, so the files in it are kept; what lives only on a sandbox's own disk (its
home folder and the tool caches there) starts empty.

It refuses a release older than the data: when the database has applied a
migration the chosen release does not carry, a later release migrated it, and
the update stops with a plain message before changing anything. Going back past
a migration is a restore of a backup made before it. If a migration fails, the
transaction is rolled back, the previous release's files are put back and it keeps
serving, and the command exits non-zero naming the migration. If the update fails
after its migrations ran (while starting the new containers, say), the install
stays on the new release: `gtmworks install` finishes it. The same holds when the
machine stops in the middle of an update: the two files of the release it was
moving to are saved and that release recorded first (`.gtmworks-pending.d`,
`.gtmworks-pending`; a main build by its digest), and `gtmworks install` finishes
the update from them. One install runs at a time: install.sh holds a lock on
`.install.lock` that the kernel drops when its process ends, so an install that
was killed never blocks the next run, and one that is still running is never
taken over. `gtmworks update`, `gtmworks install` and `gtmworks restore` hold one
lock for the whole run, kept beside the record of the install folder
(`$XDG_STATE_HOME/gtmworks/update.lock`, by default
`~/.local/state/gtmworks/update.lock`): a second one with the same state folder
stops and says another update is running. The whole command is serialized for
one user only: a run by another user (or with another `XDG_STATE_HOME`) is held
back only while install.sh itself runs, by its lock on `.install.lock`, so run
updates of one install as one user. An install
on the `main` channel updates to the newest main build; the update keeps the two
files of the build it ran (`.gtmworks-main/`), so its go-back command names that
exact build, `--version main@sha256:<digest>`. The `gtmworks` command itself is
the `get.sh` of the build the folder runs, which each image carries: an install,
an update or a `restore --version` leaves the command of the release or channel it
installed, checked to be the gtmworks installer before anything changes. A release's
`install.sh` leaves its command too, so an update run by an older command, one that
never replaced itself, still ends with the new one.

## Backup

```sh
gtmworks backup                              # dated archive in backups/
```

Backup briefly stops the stack — every Company's Engine included, and its work sandbox — for
a consistent copy of the database and its configuration (which holds each Company's
Engine record), the Storage files, each Company's Engine data volume, each Company's
work folder (the files its Agents made in its work sandbox), each Engine's key file
(`.engines/`) and `.env.install`, then starts every Engine, sandbox and the stack again.
It leaves out the tool caches an Agent's commands leave in a work folder (folders named
`.cache`, `node_modules` or `__pycache__`), which a command makes again, the links an
Agent made in a work folder (a symbolic link, and the second name of a file with two,
whose file is kept), and whatever lives only on a sandbox's own disk. Each
Engine's data holds that Company's Agents, their profiles, rules, memory, skills and
history, so a restore brings every Company back as it was. An
optional directory after `backup` changes the destination.
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
empty install's volumes, each Engine's key (`.engines/`) and `.env.install`, including its keys and origin settings,
and restarts the stack, every Company's Engine included: each Company comes back on
its own Engine, in that Engine's own container with its own network, volume and key,
so its Engine record still finds it. This is a full-install backup, not a company
export, and it includes every Company's Engine data, so every Agent comes back with
its knowledge, rules, skills and memory, and every Company's work folder comes back
into its own sandbox, without the tool caches the backup left out. Before it changes
anything, restore refuses an archive it cannot fully restore, such as one naming an
Engine without that Engine's data or its key, or one holding the work folder of some
Companies and not the others. An archive made before work folders were included
still restores: each Company gets an empty work folder and a working sandbox. An archive made before each Company had its own Engine
still restores: it holds one Engine and comes back as one Company on its own Engine.
An archive made before that data was included still restores: the
command says in one line that the Agents' Hermes data was not in it, and the worker
makes each company's profile again, empty. Do not use it to change the pinned Postgres version.
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
them back; `main` follows the newest commit of main whose CI passed, never an older one. A release install
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
`GTMWORKS_GET` (the address of main's `get.sh`, read for a build whose image carries none); `scripts/get.sh`
describes them.

The first push creates the package `ghcr.io/omarabdo516/gtmworks` **private**, and
nothing in the workflow can change that. Its owner makes it public once: on GitHub,
open the package's **Package settings**, choose **Change visibility** and set it to
**Public**. Until then a release's install test stops on its anonymous read, and
`stable`, `latest` and the GitHub Release are not published; afterwards, re-run that
workflow run's failed jobs.

## Roadmap

Next: the first real Company goes live on gtmworks, then keys for sandbox tools, then triggers and efficiency, then the rest. Building software from gtmworks comes last.

- ✅ Install with one line, update with one click
- 🟡 Hermes inside, one Engine and one work sandbox per Company (merged, waiting for the release, #572)
- ✅ Lead, the main Agent, runs the team and makes new Agents
- 🟡 Every Agent asks any other Agent for a job (Handovers) (merged, waiting for the release, #572)
- ✅ Conversations, channels and "Waiting on you"
- 🟡 Board, Cards, Projects and Routines (merged, waiting for the release, #572)
- ✅ Company knowledge, Skills, memory and team lessons
- 🟡 Connect any MCP server, and run command tools in the sandbox (merged, waiting for the release, #572)
- ✅ Roles, Invite links without email and per-Member Agent access [#948]
- 🟡 Good morning message from the main Agent (merged, waiting for the release, #572)
- ✅ English and Egyptian Arabic, dictation in Egyptian Arabic
- 🟡 Open Design, installed by you and connected from Apps: Agents make designs
- ✅ Watch the Agent's screen, take control for one session, and finish a step it hands you there
- 🟡 Stop ends a whole Handover chain
- 🟡 Numbers from connected apps (page built, no live source yet)
- ⚪ RS Academy on gtmworks: first Agents, deep knowledge
- ⚪ A key for command MCP servers in the sandbox
- ⚪ Ready-made connections: Google Drive (one folder), GitHub, Odoo
- ⚪ Event door: a webhook wakes the right Agent
- ⚪ Routine check before the model wakes, and a cheaper model for routines
- ✅ A board like the Hermes Kanban board, with simpler Cards
- ⚪ Publishing to Meta, Instagram and TikTok
- ⚪ Presenter videos made from a Card
- ⚪ Ad campaigns, Results and a monthly Diagnosis
- ⚪ Monthly plan, Brand check, Segments, Key dates, Offerings
- ✅ Several model accounts with failover
- ⚪ Stronger Agent memory
- ⚪ Talk to an Agent live by voice
- ⚪ Business lines inside a Company (only if real mixing shows the need)
- ⚪ Repo manager Agent (deferred)
- ⚪ Running the coding process from inside gtmworks (last)

The full list, with what each line means and its evidence, is in [ROADMAP.md](ROADMAP.md).

## Licence

gtmworks is released under the MIT License. See [LICENSE](LICENSE).
