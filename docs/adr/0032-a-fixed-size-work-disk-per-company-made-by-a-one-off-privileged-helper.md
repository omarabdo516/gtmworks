---
status: accepted
date: 2026-11-25
---

# A fixed-size work disk per Company, made by a one-off privileged helper

Hermes's decision for Omar of 2026-11-25 (#507): a code-architecture choice. It amends [ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md) for one exception: a privileged container, which ADR 0018 lists among what the install avoids, runs once for a Company's disk and exits. Everything else in ADR 0018 still holds.

## Context

Every Agent's terminal, file and code tools run in its Company's work sandbox, with no person approving each call (ADR 0018, ADR 0020). The sandbox had memory, CPU, process, capability and network limits, but no disk limit. Its work folder, its home and its writable layer sat on the server's own disk, beside the database, Storage, every Engine and every other Company. A Member's message, or a page an Agent reads, could make commands write until that disk was full, and a full disk stops the whole install.

Docker limits a size only on some storage. Measured on Docker 29 with its data on ext4, the disk an ordinary VPS has and the one the README supports:

- `docker volume create --opt size=…` is refused (`quota size requested but no quota support`): the `local` driver's size is XFS with project quotas only, and so is `--storage-opt size=` for a writable layer.
- The `local` driver cannot loop-mount an image file (`loop: invalid argument`).
- A read-only root with a sized `tmpfs` works, but the sandbox's home holds the Screen's one browser profile, with its sign-ins, so it must stay on a disk that persists, which needs the same limit.

Requiring XFS would make the installer refuse the ext4 servers the README supports, until their disk is made again.

## Decision

- **Each Company has a work disk:** one ext4 filesystem in an image file, `.work-disks/<Engine folder>/fs.img` in the install's folder, of a fixed size and a fixed inode count (one per 16 KiB). It holds the Company's work folder (`work/`) and its sandbox's home (`home/`). The image file grows on the server's disk only as far as the Company writes.
- **The sandbox writes nowhere else.** Its root is read-only; `/tmp` (1 GB) and `/var/tmp` (256 MB) are memory of a fixed size, counted in its memory limit; `/dev/shm` was already.
- **The size is a limit like memory and CPU:** a default in `scripts/engine-template.yml` (10 GB), and a Company's own through `company add --disk` and `company limits --disk`, kept in its Engine's folder as `SANDBOX_DISK`. A raise grows the disk; a lower size shrinks it only above what it holds: below that, the change is refused, the command says how much the disk holds, and the disk is kept as it was. A resize stops that Company's Engine and sandbox while it runs and starts them again; an online grow is not used, because it needs a capability some hosts' Docker lacks.
- **The one exception to ADR 0018: a one-off privileged helper.** A loop device and a mount need privilege, so the installer runs the work sandbox image's own `work-disk` command as a container that is privileged, uses the host's process table to mount in the Docker daemon's mount namespace (where the mount outlives the container), has no network (`--network none`), and is given only that Company's folder under `.work-disks`. It runs from the release's own image with a pinned command; nothing of the Company reaches it but its size. It runs at `company add`, at `company limits --disk`, at every install, update and restore, and after the server starts again, then exits. It never runs long, and no Agent, Engine, sandbox or app reaches it.
- **Fail closed.** The work folder and the home are `local` volumes that bind `fs/work` and `fs/home`; while the disk is not mounted those folders do not exist, so a sandbox or an Engine using them does not start, rather than write to the server's own disk. The template declares both volumes external, so Compose never makes either as a plain volume.
- **After the server starts again** the disks are not mounted, so each Company's Engine and sandbox stay stopped until the updater's every-minute run (`gtmworks updater`, ADR 0020's timer) runs `install.sh disks`, which mounts each stopped Company's disk and starts its Engine and sandbox. A machine with no updater gets them back with `gtmworks install`.
- **An install from before** keeps each work folder as a plain volume (`gtmworks-work-<folder>`). The first run of this release makes the disk at the Company's limit, or large enough to hold the folder with a quarter to spare, keeping that size as its limit, copies the folder in, and removes the volume once the run is whole. An update that goes back removes the disks it made, so the previous release runs on its own volume, and the next update moves it again.
- **Backup and restore** read and write the work folder on its disk, mounted first; the home is never in a backup, as the writable layer never was.

## Considered options

- **Require XFS with project quotas** and use Docker's own size limits, with no privileged container. Rejected: the installer would refuse the ext4 servers the README supports.
- **A long-running privileged helper** that keeps the mounts and passes them on by mount propagation. Rejected: a privileged container would run all the time, and propagation needs a shared mount on the host, which not every server has.
- **Measure the folder and stop the sandbox past a size.** Rejected: a command writes faster than any poll, so this is no limit.

## Consequences

- One privileged container runs, briefly, for each Company's disk at the steps above. It is the release's own image and a fixed command, with no network.
- The sum of the Companies' limits can exceed the server's disk: each limit holds one Company, and the README says to size the server for what the Companies write.
- After a restart a Company's Engine and sandbox start within a minute of the updater's first run, not with Docker itself.
- The Screen's sign-ins now persist across a recreate of the sandbox (an update), as they live on the disk.
