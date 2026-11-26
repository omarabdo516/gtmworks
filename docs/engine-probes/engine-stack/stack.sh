#!/bin/sh
# A throwaway Engine for the probes of spec #822 (#823): the pinned official Hermes image, unmodified and never built
# here, started as scripts/engine-template.yml starts an install's Engine, pointed at a fake model provider
# (fake-model.mjs) beside it, on a network of its own with no route out. Nothing of an install is touched: no
# database, no sign-in, no gateway, and no port is published on the host (the host reaches the bridge addresses).
#
#   sh docs/engine-probes/engine-stack/stack.sh up <name>          stand it up, print what runs, write <name>.env
#   sh docs/engine-probes/engine-stack/stack.sh down <name>        remove every container, volume and network it made
#   sh docs/engine-probes/engine-stack/stack.sh run <name> <cmd>   up, run <cmd> with the stack's env, then down,
#                                                                  also when <cmd> fails or the run is interrupted
#   sh docs/engine-probes/engine-stack/stack.sh exec <name> <cmd>  run <cmd> against a stack that is up, and leave it up
#   sh docs/engine-probes/engine-stack/stack.sh check              the ticket's own check (#823)
#
# KEEP=1 with run leaves the stack up afterwards (for exec, then down).
#
# The env file (and the environment <cmd> gets) holds ENGINE_RUN (the Run API), ENGINE_MANAGE (the management
# listener), ENGINE_KEY (the key this command made), ENGINE_CONTAINER, ENGINE_VOLUME, ENGINE_NETWORK, ENGINE_IMAGE.
# STACK_SUBNET picks the /24 (default from the name); STACK_ENV adds `-e KEY=VALUE` lines to the Engine's start
# (one per line), and STACK_MOUNTS adds `-v` lines, for a probe that needs a file in place before the Engine starts.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
# The one place the Engine release is pinned: read from the install's own template, never written here.
ENGINE=$(sed -n 's/^ *image: \(nousresearch\/hermes-agent:[^ ]*\)$/\1/p' "$REPO/scripts/engine-template.yml" | head -1)
[ -n "$ENGINE" ] || { echo "no Engine image pinned in scripts/engine-template.yml" >&2; exit 1; }
NODE=node:22.14.0-alpine3.21
STATE=${STACK_STATE:-${TMPDIR:-/tmp}/gtmworks-engine-stack}

names() {
  NAME=$1
  case "$NAME" in *[!a-z0-9-]* | '') echo "a stack name is lowercase letters, digits and dashes: $NAME" >&2; exit 2;; esac
  NET=probe-$NAME-net
  VOL=probe-$NAME-data
  ENG=probe-$NAME-engine
  MODEL=probe-$NAME-model
  if [ -z "${STACK_SUBNET:-}" ]; then
    third=$(( $(printf '%s' "$NAME" | cksum | cut -d' ' -f1) % 200 + 20 ))
    STACK_SUBNET=172.29.$third
  fi
  ENGINE_IP=$STACK_SUBNET.10
  MODEL_IP=$STACK_SUBNET.20
  ENV_FILE=$STATE/$NAME.env
}

down() {
  names "$1"
  # Every container of this stack, a probe's own helpers (probe-<name>-…) included.
  docker ps -aq --filter "name=^probe-$NAME-" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network ls -q --filter "name=^probe-$NAME-" | xargs -r docker network rm >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}

up() {
  names "$1"
  mkdir -p "$STATE"
  # Whatever an earlier stack of this name left is removed first, and a start that fails removes what it made.
  down "$1"
  trap 'down "$NAME"' EXIT
  docker image inspect "$ENGINE" >/dev/null 2>&1 || docker pull -q "$ENGINE" >/dev/null
  docker image inspect "$NODE" >/dev/null 2>&1 || docker pull -q "$NODE" >/dev/null
  KEY=probe-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
  # No route out: the Engine reaches the fake model on this network and nothing else (ADR 0018).
  docker network create --internal --subnet "$STACK_SUBNET.0/24" "$NET" >/dev/null
  docker volume create "$VOL" >/dev/null
  docker run -d --name "$MODEL" --network "$NET" --ip "$MODEL_IP" --network-alias fake-model \
    -v "$HERE/fake-model.mjs:/fake-model.mjs:ro" "$NODE" node /fake-model.mjs >/dev/null
  extra=$(mktemp)
  printf '%s\n' "${STACK_ENV:-}" | while IFS= read -r line; do if [ -n "$line" ]; then printf -- '-e\n%s\n' "$line"; fi; done > "$extra"
  printf '%s\n' "${STACK_MOUNTS:-}" | while IFS= read -r line; do if [ -n "$line" ]; then printf -- '-v\n%s\n' "$line"; fi; done >> "$extra"
  # The install's Engine environment (scripts/engine-template.yml), with the listeners bound to this network's address.
  set -- -d --name "$ENG" --network "$NET" --ip "$ENGINE_IP" \
    -e API_SERVER_PORT=8642 -e API_SERVER_HOST="$ENGINE_IP" -e API_SERVER_KEY="$KEY" \
    -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_HOST="$ENGINE_IP" -e HERMES_DASHBOARD_SESSION_TOKEN="$KEY" \
    -e HERMES_DASHBOARD_PUBLIC_URL="http://$ENGINE_IP:9119" -e HERMES_WRITE_SAFE_ROOT=/work \
    -v "$VOL:/opt/data"
  while IFS= read -r flag && IFS= read -r value; do set -- "$@" "$flag" "$value"; done < "$extra"
  rm -f "$extra"
  docker run "$@" "$ENGINE" sh -ec 'exec hermes gateway run' >/dev/null
  cat > "$ENV_FILE" <<ENV
ENGINE_RUN=http://$ENGINE_IP:8642
ENGINE_MANAGE=http://$ENGINE_IP:9119
ENGINE_KEY=$KEY
ENGINE_CONTAINER=$ENG
ENGINE_VOLUME=$VOL
ENGINE_NETWORK=$NET
ENGINE_IMAGE=$ENGINE
MODEL_ADDRESS=http://$MODEL_IP:8080
ENV
  ready "$NAME" >/dev/null
  # The model the Engine and every profile made on it uses, written where scripts/ci-install-lib.sh writes it, after the
  # first start (the image writes its own config.yaml then), and the Engine restarted to read it.
  docker exec -i -u 10000 "$ENG" sh -ec 'cat > /opt/data/config.yaml' <<YAML
model:
  provider: custom
  default: fake-model
  base_url: http://fake-model:8080/v1
  api_key: fake-model-key
  context_length: 128000
YAML
  docker restart "$ENG" >/dev/null
  ready "$NAME"
  trap - EXIT
}

# Both listeners answer 200 with the key, read from the host as a probe reads them.
ready() {
  names "$1"
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  tries=90
  while :; do
    run=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$ENGINE_RUN/health" || true)
    manage=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Authorization: Bearer $ENGINE_KEY" "$ENGINE_MANAGE/api/profiles" || true)
    [ "$run" = 200 ] && [ "$manage" = 200 ] && break
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || { echo "the Engine did not answer: Run API $run, management $manage" >&2; docker logs "$ENG" 2>&1 | tail -40 >&2; exit 1; }
    sleep 2
  done
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$ENGINE")
  echo "engine image: ${ENGINE%@*} ($digest)"
  echo "run api: $ENGINE_RUN/health $run"
  echo "management: $ENGINE_MANAGE/api/profiles $manage"
  echo "env file: $ENV_FILE"
}

command=${1:-}
case "$command" in
  up) up "${2:?name}";;
  down) down "${2:?name}";;
  run)
    name=${2:?name}; shift 2
    trap 'exit 130' INT TERM
    up "$name"
    # KEEP=1 leaves the stack up for `exec` (a probe's seed is kept for the next try); stack.sh down removes it.
    if [ "${KEEP:-0}" = 1 ]; then trap - EXIT; else trap 'down "$name"' EXIT; fi
    names "$name"
    set -a; . "$ENV_FILE"; set +a
    "$@"
    ;;
  exec)
    # A command against a stack already up (KEEP=1 run, or up), which it leaves up.
    name=${2:?name}; shift 2
    names "$name"
    [ -f "$ENV_FILE" ] || { echo "no stack $name is up" >&2; exit 1; }
    set -a; . "$ENV_FILE"; set +a
    exec "$@"
    ;;
  check) exec sh "$HERE/check.sh";;
  *) sed -n '2,20p' "$0" >&2; exit 2;;
esac
