#!/bin/sh
# Probe of #969: prints docs/engine-probes/bot-mode.md's answers again on a throwaway Engine of the pinned image, then
# removes it. The Engine runs with the install's managed configuration mounted where scripts/engine-template.yml mounts
# it (the `ssh` terminal backend, the managed .env and the file-sync hook), and its terminal reaches a Work sandbox of
# the install's own sandbox image on a network of its own, as an install's does. The key the Engine reaches the sandbox
# with is copied into its data volume from the host, as the install does; the probe itself uses only the Engine's routes.
# About three and a half minutes: the Engine's own start, a dozen Runs, four Routine runs and a minute waiting for a wake.
#
#   sh docs/engine-probes/bot-mode/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
if [ -z "${ENGINE_CONTAINER:-}" ]; then
  SANDBOX_IMAGE=$(sed -n 's/^ *image: ${SANDBOX_IMAGE:-\(.*\)}$/\1/p' "$REPO/scripts/engine-template.yml" | head -1)
  docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1 || bash "$REPO/scripts/docker-build.sh" -q -t "$SANDBOX_IMAGE" "$REPO/sandbox" >/dev/null
  export SANDBOX_IMAGE
  export STACK_MOUNTS="$REPO/scripts/engine-managed.yml:/etc/hermes/config.yaml:ro
$REPO/scripts/engine-managed.env:/etc/hermes/.env:ro
$REPO/scripts/engine-ssh-sync-files.sh:/etc/cont-init.d/06-engine-ssh-sync-files:ro"
  # As scripts/engine-template.yml: a failing cont-init hook stops the Engine, and the workers' scratch is the root's.
  export STACK_ENV="S6_BEHAVIOUR_IF_STAGE2_FAILS=2
TMPDIR=/opt/data/cache/scratch"
  exec sh "$REPO/docs/engine-probes/engine-stack/stack.sh" run bot-mode sh "$HERE/run.sh"
fi

# --- inside the stack: the Work sandbox the managed `ssh` backend names -------------------------------------------
NAME=${ENGINE_CONTAINER%-engine}
WORK_NET=$NAME-work
SANDBOX=$NAME-sandbox
keys=$(mktemp -d)
docker run --rm -u 0 -v "$keys:/keys" --entrypoint ssh-keygen "$SANDBOX_IMAGE" -q -t ed25519 -N '' -C bot-mode-probe -f /keys/id_ed25519
docker run --rm -u 0 -v "$keys:/keys" --entrypoint chmod "$SANDBOX_IMAGE" 644 /keys/id_ed25519 /keys/id_ed25519.pub
docker network create --internal "$WORK_NET" >/dev/null
docker run -d --name "$SANDBOX" --network "$WORK_NET" --network-alias sandbox --cap-drop ALL --security-opt no-new-privileges:true \
  -e SSH_AUTHORIZED_KEY="$(cat "$keys/id_ed25519.pub")" "$SANDBOX_IMAGE" >/dev/null
docker network connect "$WORK_NET" "$ENGINE_CONTAINER"
docker exec -u 10000 "$ENGINE_CONTAINER" mkdir -p /opt/data/ssh
docker cp "$keys/id_ed25519" "$ENGINE_CONTAINER:/opt/data/ssh/id_ed25519"
docker exec -u 0 "$ENGINE_CONTAINER" sh -c 'chown -R 10000:10000 /opt/data/ssh && chmod 700 /opt/data/ssh && chmod 600 /opt/data/ssh/id_ed25519'
rm -rf "$keys"
until docker exec "$SANDBOX" python3 -c "import socket; socket.create_connection(('127.0.0.1',2222),3).close()" 2>/dev/null; do sleep 1; done
SANDBOX_HOSTNAME=$(docker exec "$SANDBOX" hostname)
export SANDBOX_HOSTNAME
exec node "$HERE/probe.mjs"
