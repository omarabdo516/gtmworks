#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The isolated Docker machine an install area runs on, and the images it runs from a registry, listed once (#608):
# `./ci.sh install` loads them into its machine from the host; CI's machine pulls them itself. Those pulls stay: on
# run 45462476927 a pull-through mirror kept in the Actions cache served them in 103 s against 106 s from Docker Hub,
# because the time is the machine unpacking the layers, not their download, and restoring the mirror cost 20–27 s more.
#   images   every image the install proof pulls: the compose file, the Engine template, the fixed older releases' own
#            mailbox, the app's build bases and the checks' helper images
#   start    start the machine on 127.0.0.1:2375, removing what an earlier run on a reused runner left first
#   stop     remove the machine, whatever of it is there
machine=tcp://127.0.0.1:2375

# The fixed older releases the update areas install start one image this release does not: their mailbox, which the
# installs they make run (#956). Their commits are fixed and a fast job's checkout is shallow, so its pinned reference
# is named here rather than read from history.
older_release_images='axllent/mailpit:v1.27.10@sha256:b1f1be18af530d939a11ee8820b379e0c88eeec204d904bfad68862adced3a5a'

images() {
  { grep -h -E '^[[:space:]]*image:' docker-compose.install.yml scripts/engine-template.yml | awk '{print $2}' | grep -v '^gtmworks-local' | grep -v '\$'
    printf '%s\n' "$older_release_images"
    awk '/^FROM/ && $2 ~ /[:@]/ {print $2}' Dockerfile
    grep -o -h -E '(alpine:[0-9.]+|node:[0-9][0-9a-z.-]*|curlimages/curl:[0-9.]+|registry:[0-9.]+|mcr\.microsoft\.com/playwright:[^ "]+)' scripts/ci-install-check.sh scripts/ci-install-lib.sh scripts/install.sh scripts/get.sh; } | sort -u
}

# A removal of nothing is no failure.
stop() { docker rm -fv install-docker > /dev/null 2>&1 || true; }

start() {
  stop
  docker run -d --privileged --name install-docker \
    -e DOCKER_TLS_CERTDIR= -p 127.0.0.1:2375:2375 \
    -v "$PWD:$PWD" docker:28.5.1-dind > /dev/null
  for _ in $(seq 1 60); do docker --host "$machine" info > /dev/null 2>&1 && break; sleep 1; done
  docker --host "$machine" info > /dev/null || { echo 'install check failed: DinD readiness' >&2; exit 1; }
}

case ${1:-} in
 images) images ;;
 start) start ;;
 stop) stop ;;
 *) echo 'usage: scripts/ci-install-machine.sh images | start | stop' >&2; exit 2;;
esac
