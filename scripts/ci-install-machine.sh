#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The isolated Docker machine an install area runs on, and the images it runs from a registry (#608). Every one of those
# images is listed here once: `./ci.sh install` loads them into its machine from the host, and CI's machine pulls the
# Docker Hub ones through a pull-through mirror beside it, whose storage the Actions cache keeps under a key made of
# their list (the `install-images` job fills it), so an area reads them from its own runner instead of pulling them on
# every area. A pull through the mirror is a real pull: the machine keeps each image's digest, which the compose files
# pin and which `docker load` would drop on this machine's Docker. Without the mirror (it did not start, or its storage
# is empty) the machine pulls from the registry, as it did before.
#   images         every image the install proof pulls: the compose file, the Engine template, the app's build bases
#                  and the checks' helper images
#   mirrored       those on Docker Hub, the one registry the mirror serves
#   key            the Actions cache key of the mirror's storage
#   start STORAGE  start the mirror on STORAGE, then the machine on 127.0.0.1:2375 with the mirror as its registry mirror
#   warm STORAGE   start both, pull every mirrored image through the mirror, and remove both, so STORAGE is whole
mirror_image=registry:3.1.2@sha256:82f6ff4a7f982960c8aa51617fea3aabc485df6e55cce80d22deb1de36f1bc3c
machine=tcp://127.0.0.1:2375

images() {
  { grep -h -E '^[[:space:]]*image:' docker-compose.install.yml scripts/engine-template.yml | awk '{print $2}' | grep -v '^gtmworks-local' | grep -v '\$'
    awk '/^FROM/ && $2 ~ /[:@]/ {print $2}' Dockerfile
    grep -o -h -E '(alpine:[0-9.]+|node:[0-9][0-9a-z.-]*|curlimages/curl:[0-9.]+|registry:[0-9.]+|mcr\.microsoft\.com/playwright:[^ "]+)' scripts/ci-install-check.sh scripts/ci-install-lib.sh scripts/install.sh scripts/get.sh; } | sort -u
}
# A first path part with a dot or a colon names another registry's host.
mirrored() { images | grep -v -E '^[^/]*[.:][^/]*/'; }

start() {
  mkdir -p "$1"
  docker network create install-net > /dev/null
  # Docker Hub's content by digest never changes, so the kept storage never expires (TTL 0).
  docker run -d --name install-mirror --network install-net -v "$(realpath "$1"):/var/lib/registry" \
    -e REGISTRY_PROXY_REMOTEURL=https://registry-1.docker.io -e REGISTRY_PROXY_TTL=0 "$mirror_image" > /dev/null
  docker run -d --privileged --name install-docker --network install-net \
    -e DOCKER_TLS_CERTDIR= -p 127.0.0.1:2375:2375 \
    -v "$PWD:$PWD" docker:28.5.1-dind --registry-mirror=http://install-mirror:5000 > /dev/null
  for _ in $(seq 1 60); do docker --host "$machine" info > /dev/null 2>&1 && return; sleep 1; done
  docker --host "$machine" info > /dev/null || { echo 'install check failed: DinD readiness' >&2; exit 1; }
}

case ${1:-} in
 images) images ;;
 mirrored) mirrored ;;
 key) printf 'install-images-%s\n' "$(mirrored | sha256sum | cut -c1-16)" ;;
 start) start "$2" ;;
 warm)
  start "$2"
  for image in $(mirrored); do docker --host "$machine" pull -q "$image" > /dev/null; done
  docker rm -fv install-docker install-mirror > /dev/null
  docker network rm install-net > /dev/null
  echo "install images: $(mirrored | wc -l) kept in the mirror ($(du -sh "$2" | cut -f1))"
  ;;
 *) echo 'usage: scripts/ci-install-machine.sh images | mirrored | key | start STORAGE | warm STORAGE' >&2; exit 2;;
esac
