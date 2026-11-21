#!/bin/sh
# The file-sync probes (#393): does the Engine's ssh backend copy the Engine's own files into the work
# sandbox and copy the sandbox's changes back? Same pinned Engine, the install's sandbox image and the
# install's managed config (scripts/engine-managed.yml), with Engine variants:
#   1 the install's managed config as it is            2 plus terminal.sync_back_max_bytes: 0
#   3 the shared Skills folder mounted read-only        4 the Engine stopped before the reaper runs
#   5 the launch profile (/opt/data) reads the shared folder too, 6 as 5 read-only, 7 as 5 with the cap 0
#   3b an unreadable file in a profile's cache
#
#   sh docs/engine-probes/work-sandbox-ssh/file-sync.sh    # runs, prints, removes everything it made
#
# Heavy Docker run: takes the shared heavy lock, refuses to start below 3 GB available, removes every
# container, network, volume and image it made, touches no other container.
set -eu

LOCK=${GTMWORKS_HEAVY_LOCK:-/home/t3/.cache/gtmworks-378-SbxosC/heavy.lock}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-$(cd "$HERE/../../.." && pwd)}
[ -f "$REPO/sandbox/Dockerfile" ] || { echo "run this from the repo" >&2; exit 1; }
if [ -z "${GW393_LOCKED:-}" ]; then
  free -g | awk 'NR==2 {exit ($7 < 3)}' || { echo "not enough memory available (need >= 3 GB)" >&2; exit 1; }
  GW393_LOCKED=1 exec flock "$LOCK" /bin/sh "$HERE/$(basename "$0")" "$@"
fi

ENGINE=nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
IMAGE=gw393-sandbox:probe
NAME=gw393
INSTALL_NET=gw393-install
SANDBOX_NET=gw393-sandbox
ENGINE_IP=172.31.242.10
SANDBOX_IP=172.31.243.10
ENGINE_SANDBOX_IP=172.31.243.11
KEY=probe-install-key-0000000000000000
SHARED=/opt/data/profiles/probe-space/skills
WORK=$(mktemp -d)

cleanup() {
  docker rm -f "$NAME-engine" "$NAME-sbx" >/dev/null 2>&1 || true
  docker network rm "$INSTALL_NET" "$SANDBOX_NET" >/dev/null 2>&1 || true
  docker volume rm "$NAME-engine-data" "$NAME-shared" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

docker image inspect "$ENGINE" >/dev/null 2>&1 || docker pull "$ENGINE" >/dev/null
docker build -q -t "$IMAGE" -f "$REPO/sandbox/Dockerfile" "$REPO/sandbox" >/dev/null

mkdir -p "$WORK/keys"
ssh-keygen -q -t ed25519 -N '' -C gw393-probe -f "$WORK/keys/id_ed25519"
docker network create --subnet 172.31.242.0/24 "$INSTALL_NET" >/dev/null
docker network create --subnet 172.31.243.0/24 "$SANDBOX_NET" >/dev/null
docker volume create "$NAME-engine-data" >/dev/null
docker volume create "$NAME-shared" >/dev/null
# The key where the install keeps it (scripts/engine-managed.yml: /opt/data/ssh/id_ed25519), and the
# shared folder's mount point, both the Engine's own uid's.
docker run --rm -u 0 -v "$NAME-engine-data:/data" -v "$NAME-shared:/shared" -v "$WORK/keys/id_ed25519:/key:ro" alpine:3.21 sh -c '
  set -e
  mkdir -p /data/ssh /data/profiles/probe-space/skills
  cp /key /data/ssh/id_ed25519
  chown -R 10000:10000 /data/ssh /data/profiles /shared
  chmod 700 /data/ssh; chmod 600 /data/ssh/id_ed25519'

# The install's managed config, byte for byte, then the two variants. lifetime_seconds is the probe's
# only addition: the idle reaper tears a session's sandbox connection down after 20 s instead of 300 s.
cp "$REPO/scripts/engine-managed.yml" "$WORK/managed-1.yml"
printf '  lifetime_seconds: 20\n' >> "$WORK/managed-1.yml"
cp "$WORK/managed-1.yml" "$WORK/managed-2.yml"
printf '  sync_back_max_bytes: 0\n' >> "$WORK/managed-2.yml"
echo "managed config (variant 1):"; sed 's/^/  /' "$WORK/managed-1.yml" | grep -v '^  #'

docker run -d --name "$NAME-sbx" --network "$SANDBOX_NET" --ip "$SANDBOX_IP" --network-alias sandbox \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e SSH_AUTHORIZED_KEY="$(cat "$WORK/keys/id_ed25519.pub")" "$IMAGE" >/dev/null

engine_ready() {
  docker exec "$NAME-engine" /opt/hermes/.venv/bin/python -c "
import urllib.request
r = urllib.request.Request('http://$ENGINE_IP:9119/api/profiles', headers={'Authorization': 'Bearer $KEY'})
urllib.request.urlopen(r, timeout=5); urllib.request.urlopen('http://$ENGINE_IP:8642/health', timeout=5)"
}
start_engine() { # $1 managed config, $2 shared mount suffix ("" or ":ro")
  docker rm -f "$NAME-engine" >/dev/null 2>&1 || true
  docker run -d --name "$NAME-engine" --network "$INSTALL_NET" --ip "$ENGINE_IP" \
    -e API_SERVER_KEY="$KEY" -e API_SERVER_HOST="$ENGINE_IP" -e API_SERVER_PORT=8642 \
    -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_HOST="$ENGINE_IP" -e HERMES_DASHBOARD_SESSION_TOKEN="$KEY" \
    -e HERMES_WRITE_SAFE_ROOT=/work -e TERMINAL_LIFETIME_SECONDS=20 \
    -v "$NAME-engine-data:/opt/data" -v "$NAME-shared:$SHARED$2" \
    -v "$1:/etc/hermes/config.yaml:ro" \
    "$ENGINE" sh -ec 'exec hermes gateway run' >/dev/null
  docker network connect --ip "$ENGINE_SANDBOX_IP" "$SANDBOX_NET" "$NAME-engine"
  tries=90; until engine_ready >/dev/null 2>&1; do
    tries=$((tries - 1)); [ "$tries" -gt 0 ] || { docker logs "$NAME-engine" | tail -40; exit 1; }; sleep 2
  done
  docker exec "$NAME-engine" mkdir -p /opt/probe
  for f in provider.py probe.py file-sync.py; do docker cp "$HERE/$f" "$NAME-engine:/opt/probe/$f" >/dev/null; done
}
phase() {
  docker exec -u 10000 -e API_SERVER_KEY="$KEY" -e PROBE_ENGINE_ADDRESS="$ENGINE_IP" \
    "$NAME-engine" /opt/hermes/.venv/bin/python /opt/probe/file-sync.py "$1" 2>&1
}
logs() { # every Engine log line about the sync and the reaper's teardown
  docker exec "$NAME-engine" sh -c "find /opt/data -name '*.log' -path '*logs*' | xargs grep -h -E 'sync_back|file_sync|syncing files|Cleaned up inactive|Error cleaning' 2>/dev/null" | sort -u || true
}
wait_reaped() { # until the reaper has torn down every open session (no line for 30 s after one), max 480 s
  echo "--- waiting for the idle reaper (lifetime 20 s, sweep every 60 s)"
  total=$(logs | wc -l); before=$(logs | grep -c 'Cleaned up inactive' || true); waited=0; quiet=0
  while [ "$waited" -lt 480 ]; do
    sleep 10; waited=$((waited + 10))
    now=$(logs | grep -c 'Cleaned up inactive' || true)
    if [ "$now" -gt "$before" ]; then quiet=$((quiet + 10)); [ "$quiet" -ge 30 ] && break; fi
  done
  echo "--- the Engine's new log lines after ${waited}s:"; logs | tail -n +$((total + 1)) | sed 's/^/  /'
}
sandbox_reset() { docker exec "$NAME-sbx" rm -rf /home/pn/.hermes; }

echo; echo "=== variant 1: the install's managed config"
start_engine "$WORK/managed-1.yml" ""
phase setup
phase upload
echo "--- the sandbox's own view of ~/.hermes (owner, mode)"
docker exec "$NAME-sbx" sh -c 'find /home/pn/.hermes -type f -exec stat -c "%U %a %n" {} + | sort'
wait_reaped
phase check
phase run_after

echo; echo "=== variant 2: plus terminal.sync_back_max_bytes: 0"
sandbox_reset
start_engine "$WORK/managed-2.yml" ""
phase edit_again
wait_reaped
phase check

echo; echo "=== variant 3: the shared folder mounted read-only (cap removed)"
sandbox_reset
start_engine "$WORK/managed-1.yml" ":ro"
echo "--- the Engine's write to the shared folder: $(docker exec -u 10000 "$NAME-engine" sh -c "touch $SHARED/x 2>&1 || true")"
phase edit_again
wait_reaped
phase check
phase run_after

echo; echo "=== variant 4: the Engine stopped (docker stop) before the reaper runs"
sandbox_reset
start_engine "$WORK/managed-1.yml" ""
phase edit_again
docker stop -t 60 "$NAME-engine" >/dev/null
start_engine "$WORK/managed-1.yml" ""
echo "--- the stop's log lines:"; logs | tail -8 | sed 's/^/  /'
phase check

echo; echo "=== variant 5: the launch profile also reads the shared folder (reaper)"
sandbox_reset
phase root_shared
echo "--- the launch profile's config, terminal section:"; docker exec "$NAME-engine" sh -c "grep -A12 '^terminal:' /opt/data/config.yaml | grep -E 'terminal:|lifetime|backend'" | sed 's/^/  /' || true
phase edit_again
wait_reaped
phase check

echo; echo "=== variant 6: as 5, the shared folder mounted read-only"
sandbox_reset
start_engine "$WORK/managed-1.yml" ":ro"
echo "--- the reaper's lifetime as the restarted Engine resolves it: $(docker exec -u 10000 "$NAME-engine" /opt/hermes/.venv/bin/python -c "
import os; os.environ['HERMES_HOME']='/opt/data'
from tools.terminal_tool import _get_env_config; print(_get_env_config()['lifetime_seconds'])" 2>&1 | tail -1)"
phase edit_again
wait_reaped
phase check
phase run_after
echo "--- the Engine's warnings:"; docker exec "$NAME-engine" sh -c "find /opt/data -name 'errors.log' | xargs grep -h -E 'sync' 2>/dev/null | tail -4" | sed 's/^/  /' || true

echo; echo "=== variant 7: as 5, plus terminal.sync_back_max_bytes: 0"
sandbox_reset
start_engine "$WORK/managed-2.yml" ""
phase edit_again
wait_reaped
phase check

echo; echo "=== variant 3b: an unreadable file in A's cache (root-owned, mode 000)"
docker exec -u 0 "$NAME-engine" sh -c '
  d=/opt/data/profiles/probe-a/cache/documents
  echo "GW393 root-only" > $d/gw393-root-only.txt; chown 0:0 $d/gw393-root-only.txt; chmod 000 $d/gw393-root-only.txt
  echo "GW393 late, readable" > $d/gw393-late.txt; chown 10000:10000 $d/gw393-late.txt'
phase unreadable
echo "--- the Engine's warnings:"; docker exec "$NAME-engine" sh -c "find /opt/data -name 'errors.log' | xargs grep -h -E 'file_sync|sync' 2>/dev/null | tail -5" | sed 's/^/  /' || true

echo; echo "probe finished; everything it made is removed"
