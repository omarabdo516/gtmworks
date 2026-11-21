# The work sandbox every Company's Agents run in (ADR 0018): the Engine's own sandbox image, unmodified, with the work
# tools, Arabic fonts, an ordinary user and an sshd that accepts a key and no password.
#
# The base is the image the pinned Engine uses for its sandboxed terminal and screen (v0.23.0). The pin is here and
# nowhere else: the tag names the reviewed release and the digest the reviewed bytes, so a re-pushed tag cannot change
# what an install runs. `lib/work-sandbox-image.mjs` reads this line and fails when it is not tag@sha256.
FROM nousresearch/hermes-sandbox:desktop@sha256:df6768a595eaa09a9549237533421bf0557221ec0c13a825c9c202a13ddd37bb

USER root

# The work tools a marketer's job needs, the Arabic fonts a rendered image or video is drawn in, and what the `ssh`
# backend needs to reach this container: sshd, and `ss` so an install owner can see what listens.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends \
      ffmpeg \
      fonts-noto-core \
      iproute2 \
      openssh-server \
 && rm -rf /var/lib/apt/lists/*

# Chromium is the browser the base image already ships for Playwright, which is the one the Engine's screen drives. One
# browser, not two, so a page an Agent renders is the page the screen shows. A container cannot make Chromium's own
# namespace sandbox (no capability, no new privilege), so it is off here: the container is the sandbox.
RUN set -eux; \
    chrome=$(find /opt/playwright -maxdepth 3 -type f -path '*/chrome-linux64/chrome' | head -n 1); \
    test -n "$chrome"; \
    printf '%s\n' '#!/bin/sh' \
      'exec '"$chrome"' --no-sandbox --disable-dev-shm-usage "$@"' > /usr/local/bin/chromium; \
    chmod 0755 /usr/local/bin/chromium

# The package makes host keys when it installs; no key is baked into an image every install runs, so the entrypoint makes
# them when a container starts. No authorized key is here either: the public key arrives at run time.
RUN rm -f /etc/ssh/ssh_host_*

# The work user is the base image's own ordinary user: uid 1000, no password, no groups, no sudo. The Engine's ssh
# backend syncs into this home, and the Company's work folder is mounted at /work.
RUN set -eux; \
    install -d -o pn -g pn -m 700 /home/pn/.ssh /home/pn/.ssh-host; \
    install -d -o pn -g pn -m 755 /work

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/work-sandbox-entrypoint
COPY work-shell /usr/local/bin/work-shell
RUN chmod 0755 /usr/local/bin/work-sandbox-entrypoint /usr/local/bin/work-shell
# sshd starts every session through the user's login shell, which is where an Agent's own start folder is made before the
# Engine's command runs (work-shell, #393).
RUN set -eux; \
    if command -v usermod > /dev/null 2>&1; then usermod --shell /usr/local/bin/work-shell pn; \
    else sed -i 's#^\(pn:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:\).*$#\1/usr/local/bin/work-shell#' /etc/passwd; fi; \
    test "$(getent passwd pn | cut -d: -f7)" = /usr/local/bin/work-shell

# No host key and no authorized key are in the image: the entrypoint makes a host key when the container starts and takes
# the public key that arrives at run time, in SSH_AUTHORIZED_KEY or in the file SSH_AUTHORIZED_KEYS_FILE names.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/pn \
    SSH_AUTHORIZED_KEYS_FILE=/run/authorized_keys
WORKDIR /work
USER pn
EXPOSE 2222
ENTRYPOINT ["/usr/local/bin/work-sandbox-entrypoint"]
