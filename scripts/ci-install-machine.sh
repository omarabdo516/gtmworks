#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The isolated Docker machine an install area runs on, and the images it runs from a registry, listed once (#608):
# `./ci.sh install` loads them into its machine from the host; CI's machine pulls them itself. Those pulls stay: on
# run 45462476927 a pull-through mirror kept in the Actions cache served them in 103 s against 106 s from Docker Hub,
# because the time is the machine unpacking the layers, not their download, and restoring the mirror cost 20–27 s more.
#   images   every image the install proof pulls: the compose file, the Engine template, the fixed older releases' own
#            compose files, the app's build bases and the checks' helper images
#   start    start the machine on 127.0.0.1:2375, removing what an earlier run on a reused runner left first
#   stop     remove the machine, whatever of it is there
machine=tcp://127.0.0.1:2375

images() {
  { grep -h -E '^[[:space:]]*image:' docker-compose.install.yml scripts/engine-template.yml | awk '{print $2}' | grep -v '^gtmworks-local' | grep -v '\$'
    # The fixed commits the update areas install before this release still pin the images their own compose files name,
    # such as the mailbox this release removes; the local machine cannot pull, so they load from here too (#956).
    for commit in $(sed -n 's/^\(previous_release_commit\|before_sandbox_release_commit\)=//p' scripts/ci-install-lib.sh); do
      git show "$commit:docker-compose.install.yml" 2> /dev/null | grep -E '^[[:space:]]*image:' | awk '{print $2}' | grep -v '^gtmworks-local' | grep -v '\$' || true
    done
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
