---
status: accepted
date: 2026-11-20
---

# Update now goes through an updater on the host; the web app never controls Docker

Hermes's decision of 2026-11-20 (#443), reversible. Built with #443. It keeps [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md)'s rule that no container of the install reaches Docker.

## Context

Owners should take each new gtmworks version with one click, as T3 Code's "Update ready" does (#442 tells them one exists). An update stops and recreates every container, so whatever runs it needs Docker on the server. Giving the web app Docker would mean anyone who broke into the web app owns the server.

## Decision

- The install puts a small **updater** on the host, run as the user who installed, every minute: a systemd user timer, or a cron line where systemd user units are missing. It is the `gtmworks` command itself (`gtmworks updater`), so it always matches the version installed. The one line, `gtmworks install` and every `gtmworks update` that moves to another version write it again; nothing removes it.
- The web app only records **that an Owner asked**: `request_install_update()` sets one row, `public.install_updates`, to `requested`. No database role the app uses through the API reaches that row otherwise, the service role included: reading goes through `install_update()`, which answers active Owners only, and the install owner's switches and the updater's results are written by the updater as `postgres` inside the database container. Until #446 the web container held the database password (its environment was the whole `.env.install`), so a break-in into the app could write the row directly. It now holds neither the password nor the JWT secret, so it reaches the row only as the service role does; the switches are still recorded as the install owner's preference, not a security boundary, and the boundary is the next point.
- The updater **chooses the version itself**: it runs `gtmworks update` with no option, exactly as a person would, under the same update lock, so it goes to the newest version of the install's own channel. It reads four values from the row (the button, automatic updates, the state and whether an hour has passed since the last automatic check) and passes none of them on. The worst a broken-in web app can do is start a normal update to the official newest version.
- **Who can click:** active Owners of any Company of the install. `gtmworks update-button off` hides the button and makes the updater ignore any request; it is on by default.
- **Automatic updates:** `gtmworks auto-update on` makes the updater run the same update by itself, at most once an hour; off by default.
- **One failure, then a pause:** for an hour after a failed update a new request is refused, so clicking again does not repeat a backup-and-restore cycle while the same release is still the newest.
- **Safety:** every update takes the backup it already takes. When the new version does not come up healthy, the update puts the previous release back itself if no migration ran; if one ran and the new version never recorded itself as running, the updater restores the update's own backup with the previous version (`gtmworks restore <archive> --version <previous> --yes --no-backup`: that backup is the data from before, and the half-started install cannot be backed up again). The row then says `failed` with the version still running, and the app shows it.

## Considered options

- **The web app runs the update** (Docker socket in the web container). Rejected: one break-in owns the server.
- **A request that names the version.** Rejected: the web app would choose what the server runs.
- **A small daemon listening on a port.** Rejected: one more service to secure and keep running, where a timer and the database already exist.

## Update ready reads the published image, not the branch (#468)

Update ready (#442) used to read `lib/whats-new.json` from the `main` **branch**, while the updater installs the published `:main` **image**. The image lags the branch by a whole CI and release run, and never catches up to a commit whose CI failed, so in that window the app offered what the updater could not install and **Update now** did nothing.

- The offer now reads the commit the published `:main` index records in its `org.opencontainers.image.revision` annotation — the same value the release workflow compares before publishing (#448), so there is one source for "the newest main" and not a second one. The app fetches an anonymous pull token for the public package, then the index, over HTTPS: it still chooses no version and still reaches no Docker.
- A merge with no published image yet offers nothing, and a main install is offered only the entries that image carries that its own build lacks.
- When the updater finds nothing newer after an Owner's request, it records `current` with the version still running, and the Owner reads that they already run the newest gtmworks rather than the same offer coming back.

## Consequences

- A click reaches the server within a minute, not at once.
- A user's systemd timers run only while that user is signed in unless linger is on: the install says so and prints `sudo loginctl enable-linger <user>` when it cannot turn it on itself.
- A machine with neither systemd user units nor cron gets no updater; the install says so, and `gtmworks update` still works.
- The updater's last run is kept in `.gtmworks-updater.log` in the install folder, readable by the install user only.
