#!/bin/sh
# Probe B of spec #822 (#826, #827): prints docs/engine-probes/engine-dashboard.md's answers again. It needs the local
# gtmworks stack up (bash scripts/local-db.sh, or npm run cloud:up): its sign-in and its members table decide who is an
# Owner. It stands up a throwaway Engine of the pinned image with gtmworks's theme in its data volume, the install's
# pinned gateway (nginx) in front of it with the probe's gate (gate.mjs), drives Chromium through the gateway, then
# removes everything it made, the people it added to the local database included. No Engine port is published: the
# gateway alone is, on 127.0.0.1.
#
#   sh docs/engine-probes/engine-dashboard/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
if [ -z "${ENGINE_CONTAINER:-}" ]; then
  status=$(cd "$REPO" && npx --no-install supabase status -o env 2>/dev/null) || { echo "the local gtmworks stack is not up: run bash scripts/local-db.sh" >&2; exit 1; }
  SUPABASE_URL=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
  SUPABASE_ANON_KEY=$(printf '%s\n' "$status" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
  SUPABASE_SERVICE_ROLE_KEY=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
  export SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
  # The Company's Work sandbox as the install runs it (scripts/engine-template.yml): the install's own sandbox image, the
  # managed `ssh` backend file and the file-sync hook mounted where the template mounts them.
  SANDBOX_IMAGE=$(sed -n 's/^ *image: ${SANDBOX_IMAGE:-\(.*\)}$/\1/p' "$REPO/scripts/engine-template.yml" | head -1)
  docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1 || bash "$REPO/scripts/docker-build.sh" -q -t "$SANDBOX_IMAGE" "$REPO/sandbox" >/dev/null
  export SANDBOX_IMAGE
  export STACK_MOUNTS="$REPO/scripts/engine-managed.yml:/etc/hermes/config.yaml:ro
$REPO/scripts/engine-ssh-sync-files.sh:/etc/cont-init.d/06-engine-ssh-sync-files:ro"
  export STACK_ENV="S6_BEHAVIOUR_IF_STAGE2_FAILS=2"
  exec sh "$REPO/docs/engine-probes/engine-stack/stack.sh" run engine-dashboard sh "$HERE/run.sh"
fi

# --- inside the stack: the theme, the gate and the gateway --------------------------------------------------------
NAME=${ENGINE_CONTAINER%-engine}
FRONT=$NAME-front
GATE=$NAME-gate
GATEWAY_CONTAINER=$NAME-gateway
PORT=${PROBE_GATEWAY_PORT:-39119}
NGINX=$(sed -n 's/^ *image: \(nginx:[^ ]*\)$/\1/p' "$REPO/docker-compose.install.yml" | head -1)
ENGINE_HOST=${ENGINE_MANAGE#http://}

# The sandbox on a work network of its own with no route out, the Engine's second leg on it, and the key pair the
# install makes per Engine: the private half in the Engine's volume where engine-managed.yml names it.
WORK_NET=$NAME-work
SANDBOX=$NAME-sandbox
keys=$(mktemp -d)
docker run --rm -u 0 -v "$keys:/keys" --entrypoint ssh-keygen "$SANDBOX_IMAGE" -q -t ed25519 -N '' -C engine-dashboard-probe -f /keys/id_ed25519
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
export SANDBOX_HOSTNAME
SANDBOX_HOSTNAME=$(docker exec "$SANDBOX" hostname)

docker exec -u 10000 "$ENGINE_CONTAINER" mkdir -p /opt/data/dashboard-themes
docker cp "$HERE/gtmworks-theme.yaml" "$ENGINE_CONTAINER:/opt/data/dashboard-themes/gtmworks.yaml"
docker exec -u 0 "$ENGINE_CONTAINER" chown 10000:10000 /opt/data/dashboard-themes/gtmworks.yaml
curl -sf -X PUT -H "Authorization: Bearer $ENGINE_KEY" -H 'Content-Type: application/json' \
  -d '{"config":{"dashboard":{"theme":"gtmworks"}}}' "$ENGINE_MANAGE/api/config" >/dev/null

docker network create "$FRONT" >/dev/null
docker run -d --name "$GATE" --network "$FRONT" --network-alias gate --add-host host.docker.internal:host-gateway \
  -e SUPABASE_URL="$(printf '%s' "$SUPABASE_URL" | sed 's#127\.0\.0\.1#host.docker.internal#')" -e SUPABASE_ANON_KEY \
  -v "$HERE/gate.mjs:/gate.mjs:ro" node:22.14.0-alpine3.21 node /gate.mjs >/dev/null
conf=$(mktemp)
sed -e "s#@GATE@#gate:8080#" -e "s#@ENGINE_HOST@#$ENGINE_HOST#g" -e "s#@ENGINE_KEY@#$ENGINE_KEY#" "$HERE/gateway.conf.template" > "$conf"
chmod 644 "$conf"
docker run -d --name "$GATEWAY_CONTAINER" --network "$FRONT" -p "127.0.0.1:$PORT:8080" \
  -v "$conf:/etc/nginx/conf.d/default.conf:ro" "$NGINX" >/dev/null
docker network connect "$ENGINE_NETWORK" "$GATEWAY_CONTAINER"
until curl -s -o /dev/null "http://127.0.0.1:$PORT/"; do sleep 1; done
echo "gateway: $NGINX at http://127.0.0.1:$PORT, the Engine behind it at $ENGINE_HOST (no Engine port published)"
status=0
GATEWAY="http://127.0.0.1:$PORT" GATE_CONTAINER="$GATE" node "$HERE/probe.mjs" || status=$?
rm -f "$conf"
exit $status
