# The work sandbox every Company's Agents run in (ADR 0018): the Engine's own sandbox image, unmodified, with the work
# tools, Arabic fonts, an ordinary user and an sshd that accepts a key and no password.
#
# The base is the image the pinned Engine uses for its sandboxed terminal and screen (v0.23.0). The pin is here and
# nowhere else: the tag names the reviewed release and the digest the reviewed bytes, so a re-pushed tag cannot change
# what an install runs. `lib/work-sandbox-image.mjs` reads this line and fails when it is not tag@sha256.
#
# The browser stage comes first and alone, so CI builds just it for every platform the release builds (#572): that
# needs no package download under emulation, and a platform whose browser is not where this step looks fails there,
# before a release does.
FROM nousresearch/hermes-sandbox:desktop@sha256:df6768a595eaa09a9549237533421bf0557221ec0c13a825c9c202a13ddd37bb AS browser

USER root

# Chromium is the browser the base image already ships for Playwright, which is the one the Engine's screen drives. One
# browser, not two, so a page an Agent renders is the page the screen shows. A container cannot make Chromium's own
# namespace sandbox (no capability, no new privilege), so it is off here: the container is the sandbox.
# Playwright names Chromium's folder for the platform: chrome-linux64 on amd64, chrome-linux-arm64 on arm64 (#572). The
# release builds both; any other platform stops here with its name, and so does a platform whose folder is missing.
RUN set -eux; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in \
      amd64) folder=chrome-linux64 ;; \
      arm64) folder=chrome-linux-arm64 ;; \
      *) echo "no Chromium folder is known for $arch" >&2; exit 1 ;; \
    esac; \
    chrome=$(find /opt/playwright -maxdepth 3 -type f -path "*/$folder/chrome" | head -n 1); \
    test -n "$chrome" || { echo "no Chromium at /opt/playwright/*/$folder/chrome on $arch" >&2; exit 1; }; \
    printf '%s\n' '#!/bin/sh' \
      'exec '"$chrome"' --no-sandbox --disable-dev-shm-usage "$@"' > /usr/local/bin/chromium; \
    chmod 0755 /usr/local/bin/chromium

# Open Design (#544, ADR 0025), built from its source on the same base, so its daemon and its native modules run on the
# sandbox's own Node, on each platform the release builds. Its `od` command (apps/daemon/dist/cli.js), which holds the MCP server, is published in no package,
# so the release is fetched by commit: the 0.27.1 tag, open-design-v0.27.1, is this commit, and a commit cannot be
# pushed again. The whole workspace is installed from its lockfile, as Open Design's own postinstall builds its packages,
# and only the daemon with its production dependencies is kept. Nothing of this stage but that folder reaches the image.
FROM browser AS open-design
USER root
ARG OPEN_DESIGN_COMMIT=b83646f4afb9b21b415d98c4d073477d077d7943
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates git g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
# The build machine's extra CA, when scripts/docker-build.sh hands one over as the secret build-ca (a cloud session's
# network re-signs TLS, #562), is trusted only while this step runs; nothing of it reaches a layer. One step, which ends
# by removing the source, the workspace's packages and pnpm's store, so the stage's one layer holds only the daemon and
# a build cache keeps no more than that.
RUN --mount=type=secret,id=build-ca set -eu; \
    if [ -f /run/secrets/build-ca ]; then export GIT_SSL_CAINFO=/run/secrets/build-ca NODE_EXTRA_CA_CERTS=/run/secrets/build-ca; fi; \
    export CI=true ONNXRUNTIME_NODE_INSTALL_CUDA=skip ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; \
    mkdir /src && cd /src \
 && git init --quiet . && git fetch --quiet --depth 1 https://github.com/nexu-io/open-design.git "$OPEN_DESIGN_COMMIT" \
 && git checkout --quiet FETCH_HEAD && test "$(git rev-parse HEAD)" = "$OPEN_DESIGN_COMMIT" \
 && npm install --prefix /opt/pnpm --no-fund --no-audit pnpm@10.33.2 && export PATH="/opt/pnpm/node_modules/.bin:$PATH" \
 && pnpm install --frozen-lockfile \
 && pnpm --filter @open-design/daemon deploy --prod --legacy /opt/open-design/app \
 && test -f /opt/open-design/app/dist/cli.js \
 && cp LICENSE /opt/open-design/app/LICENSE \
 && cd / && rm -rf /src /opt/pnpm /root/.local/share/pnpm /root/.cache /root/.npm

FROM browser

# The work tools a marketer's job needs, the Arabic fonts a rendered image or video is drawn in, and what the `ssh`
# backend needs to reach this container: sshd, and `ss` so an install owner can see what listens. e2fsprogs is for the
# Company's work disk, which the installer makes and resizes with this image (work-disk, #507); the sandbox never runs it.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends \
      e2fsprogs \
      ffmpeg \
      fonts-noto-core \
      iproute2 \
      openssh-server \
 && rm -rf /var/lib/apt/lists/*

# The package makes host keys when it installs; no key is baked into an image every install runs, so the entrypoint makes
# them when a container starts. No authorized key is here either: the public key arrives at run time.
RUN rm -f /etc/ssh/ssh_host_*

# The work user is the base image's own ordinary user: uid 1000, no password, no groups, no sudo. The Engine's ssh
# backend syncs into this home, and the Company's work folder is mounted at /work.
RUN set -eux; \
    install -d -o pn -g pn -m 700 /home/pn/.ssh /home/pn/.ssh-host; \
    install -d -o pn -g pn -m 755 /work

# Open Design's daemon and its `od` command, built above; the MCP command the Engine runs for an Agent, the daemon it
# starts for that Agent, and the `hermes` runtime the daemon draws a design with, which is the Company's own Engine
# (sandbox/open-design). The route to the Engine arrives when the Engine connects, in the work user's home; none is here.
COPY --from=open-design /opt/open-design/app /opt/open-design/app
COPY open-design/open-design-mcp /usr/local/bin/open-design-mcp
COPY open-design/daemon.mjs open-design/hermes-engine.mjs /usr/local/lib/gtmworks/open-design/
RUN set -eux; \
    ln -s "$(command -v node)" /opt/open-design/node; \
    chmod 0755 /usr/local/bin/open-design-mcp /usr/local/lib/gtmworks/open-design/hermes-engine.mjs; \
    chmod 0644 /usr/local/lib/gtmworks/open-design/daemon.mjs; \
    install -d -o pn -g pn -m 700 /home/pn/.gtmworks
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/work-sandbox-entrypoint
COPY work-shell /usr/local/bin/work-shell
# The Company's exit (#394): the HTTP proxy the template runs from this same image as a container of its own, so an install
# carries no second image for it and the exit is pinned with the release as the sandbox is. The sandbox never runs it.
COPY exit.py /usr/local/lib/gtmworks/exit.py
# The Company's work disk (#507, ADR 0032): the installer's one-off helper runs this fixed command from this image, as root
# with a loop device and the Docker daemon's mount namespace; the sandbox itself, its user and its Agents never run it.
COPY work-disk /usr/local/bin/work-disk
RUN chmod 0755 /usr/local/bin/work-sandbox-entrypoint /usr/local/bin/work-shell /usr/local/bin/work-disk \
 && chmod 0644 /usr/local/lib/gtmworks/exit.py
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
# The sandbox's one way out is its Company's exit, at the alias and port the Company's template gives it (#394): the
# sandbox's own network routes nowhere, so a tool that ignores these reaches nothing. sshd sets the same for every session
# the Engine opens (sshd_config); Node's own fetch reads them where its release can. Loopback stays direct.
ENV HTTP_PROXY=http://exit:3128 \
    HTTPS_PROXY=http://exit:3128 \
    http_proxy=http://exit:3128 \
    https_proxy=http://exit:3128 \
    NO_PROXY=localhost,127.0.0.1,::1 \
    no_proxy=localhost,127.0.0.1,::1 \
    NODE_USE_ENV_PROXY=1
WORKDIR /work
USER pn
EXPOSE 2222
ENTRYPOINT ["/usr/local/bin/work-sandbox-entrypoint"]
