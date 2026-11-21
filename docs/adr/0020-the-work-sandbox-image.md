---
status: accepted
date: 2026-11-19
---

# The work sandbox image

[ADR 0018](0018-an-engine-and-a-work-sandbox-per-company.md) gives every Company a work sandbox: a second container, built on the Engine's own sandbox image with the work tools added. This record fixes what that image is, because the Company's sandbox template and the install job both build on it.

## Decision

- **One build file, one pin.** `sandbox/Dockerfile` is the image's only build file and names one base image: `nousresearch/hermes-sandbox`, the image the pinned Engine (v0.23.0) uses for its sandboxed terminal and screen, pinned by tag and digest. A tag alone can be pushed again upstream, so the digest names the reviewed bytes. `lib/work-sandbox-image.mjs` reads that line and refuses a base that is not pinned by both, and `tests/work-sandbox-image.test.mjs` fails on a pin by tag alone.
- **What is added.** ffmpeg, the Arabic fonts of `fonts-noto-core`, `openssh-server` and `iproute2` over the base's own Node, Python, Xvfb and Playwright Chromium. There is no second browser: `chromium` is the base's own binary, the one the Engine's screen drives, with Chromium's own sandbox off because a container has no capability to build one in and the container is the sandbox.
- **An ordinary user, no root.** The work user is the base image's own `pn` (uid 1000, no password, no groups, no sudo), and the container runs as that user from its first process. The Company's work folder is mounted at `/work`; the Engine's `ssh` backend syncs into the same user's home.
- **A key arrives, none is baked.** sshd runs as that ordinary user on port **2222** and only ever becomes the user it already is, so the container needs no capability and no new privilege. It accepts a public key and no password, no interactive challenge and no root login. The public key arrives at run time in `SSH_AUTHORIZED_KEY` or in the file `SSH_AUTHORIZED_KEYS_FILE` names; each container makes its own host key when it starts. The image holds no host key, no authorized key and no credential, and nothing listens but that sshd.
- **Proven, not assumed.** `scripts/check-work-sandbox.mjs --image <ref>` proves every acceptance criterion of #392 against a built image: the four tools as the ordinary user, a line of Arabic drawn by the image's Chromium in Noto Naskh Arabic with joined letters and its expected width, a two-second video with Arabic burned in, no secret or key in the image's files or environment, the port list, and the size on disk. The install job calls it after it builds the image.

## Consequences

- The base image is a desktop image; the built sandbox is about 3.26 GB on disk, as the install job measures it. An install pulls or builds one such image and every Company's sandbox runs it.
- A change of base image is a change of the pin in that one line, and the check script says so when the built image's layers do not start with the pinned base's.
- The Engine's `ssh` backend is pinned to the work user, the port and the key path; those three are part of the Company's sandbox template, not of a profile or Settings.
