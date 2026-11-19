#!/bin/sh
# Reruns every probe in docs/engine-probes/work-sandbox-ssh.md: the pinned Engine, a throwaway
# second container reached over the Engine's `ssh` terminal backend, and a fake model provider that
# scripts the tool calls.
#
#   sh docs/engine-probes/work-sandbox-ssh/run.sh          # runs, prints, removes everything it made
#   KEEP=1 sh docs/engine-probes/work-sandbox-ssh/run.sh   # leaves the containers for inspection
#
# It is a heavy Docker run: it takes the shared heavy lock, refuses to start below 3 GB available,
# and removes every container, network, volume and image it made. It touches no other container.
set -eu

# The machine's shared heavy lock, so a Docker build here never runs beside another thread's.
LOCK=${GTMWORKS_HEAVY_LOCK:-/home/t3/.cache/gtmworks-378-SbxosC/heavy.lock}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-$(cd "$HERE/../../.." && pwd)}
[ -f "$REPO/sandbox/Dockerfile" ] || { echo "run this from the repo: $HERE is not docs/engine-probes/work-sandbox-ssh" >&2; exit 1; }

# Everything below runs under the one heavy lock, this script included.
if [ -z "${GW390_LOCKED:-}" ]; then
  free -g | awk 'NR==2 {exit ($7 < 3)}' || {
    echo "not enough memory available (need >= 3 GB); not starting" >&2
    exit 1
  }
  GW390_LOCKED=1 exec flock "$LOCK" /bin/sh "$HERE/$(basename "$0")" "$@"
fi

ENGINE=nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
SANDBOX=nousresearch/hermes-sandbox:desktop@sha256:df6768a595eaa09a9549237533421bf0557221ec0c13a825c9c202a13ddd37bb
IMAGE=gw390-sandbox:probe
INSTALL_NET=gw390-install
SANDBOX_NET=gw390-sandbox
ENGINE_IP=172.31.240.10
SANDBOX_IP=172.31.241.10
ENGINE_SANDBOX_IP=172.31.241.11
KEY=probe-install-key-0000000000000000
NAME=gw390

WORK=$(mktemp -d)

cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then
    echo "kept: containers $NAME-engine $NAME-sbx, work dir $WORK" >&2
    return
  fi
  docker rm -f "$NAME-engine" "$NAME-sbx" "$NAME-control" >/dev/null 2>&1 || true
  docker network rm "$INSTALL_NET" "$SANDBOX_NET" >/dev/null 2>&1 || true
  docker volume rm "$NAME-engine-data" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

say() { echo "$@"; }

# --- the images the probe runs, pinned ----------------------------------------------------------
docker image inspect "$ENGINE" >/dev/null 2>&1 || docker pull "$ENGINE" >/dev/null
docker image inspect "$SANDBOX" >/dev/null 2>&1 || docker pull "$SANDBOX" >/dev/null
# The second container is the install's own work sandbox image (#392, sandbox/Dockerfile): the Engine's
# published sandbox image pinned by digest, with the sshd the ssh backend needs, the work user `pn`, and
# the work folder at /work. Nothing about it is made up for the probe.
docker build -q -t "$IMAGE" -f "$REPO/sandbox/Dockerfile" "$REPO/sandbox" >/dev/null

# --- what the probe needs in place before anything starts ---------------------------------------
mkdir -p "$WORK/keys"
ssh-keygen -q -t ed25519 -N '' -C gw390-probe -f "$WORK/keys/id_ed25519"
cp "$WORK/keys/id_ed25519.pub" "$WORK/keys/authorized_keys"
chmod 644 "$WORK/keys/authorized_keys"

docker network create --subnet 172.31.240.0/24 "$INSTALL_NET" >/dev/null
docker network create --subnet 172.31.241.0/24 "$SANDBOX_NET" >/dev/null
docker volume create "$NAME-engine-data" >/dev/null

# The sandbox's private key lives among the Engine's own files, and a stand-in model sign-in sits
# where Hermes keeps it (hermes_cli/auth.py: <home>/auth.json) so the probes can attempt to read it.
docker run --rm -u 0 -v "$NAME-engine-data:/data" -v "$WORK/keys/id_ed25519:/key:ro" alpine:3.21 sh -c '
  set -e
  mkdir -p /data/probe-ssh
  cp /key /data/probe-ssh/id_ed25519
  printf "%s\n" "{\"providers\":{\"openai\":{\"token\":\"gw390-STAND-IN-MODEL-SIGN-IN\"}}}" > /data/auth.json
  chown -R 10000:10000 /data/probe-ssh /data/auth.json
  chmod 700 /data/probe-ssh
  chmod 600 /data/probe-ssh/id_ed25519 /data/auth.json'

docker run -d --name "$NAME-sbx" --network "$SANDBOX_NET" --ip "$SANDBOX_IP" --network-alias sandbox \
  -e SSH_AUTHORIZED_KEY="$(cat "$WORK/keys/id_ed25519.pub")" "$IMAGE" >/dev/null
# What the sandbox holds before any Agent runs: two files that exist nowhere else, and one folder per
# Agent for the start-folder probe.
docker exec -u 0 "$NAME-sbx" sh -c '
  set -e
  mkdir -p /work/ag-probe-agent /work/ag-probe-open
  echo "gw390-sandbox-only this file exists in the second container and nowhere else" > /work/sandbox-only.txt
  /usr/local/bin/python3 -c "
import base64
open(\"/work/image.png\",\"wb\").write(base64.b64decode(
 \"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\"))"
  chown -R pn:pn /work'
docker exec "$NAME-sbx" sh -c 'test -f /home/pn/.ssh/authorized_keys' || { docker logs "$NAME-sbx"; exit 1; }

docker run -d --name "$NAME-engine" --network "$INSTALL_NET" --ip "$ENGINE_IP" \
  -e API_SERVER_KEY="$KEY" \
  -e API_SERVER_HOST="$ENGINE_IP" -e API_SERVER_PORT=8642 \
  -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_HOST="$ENGINE_IP" \
  -e HERMES_DASHBOARD_SESSION_TOKEN="$KEY" \
  -e HERMES_WRITE_SAFE_ROOT=/work \
  -v "$NAME-engine-data:/opt/data" \
  -v "$HERE/managed-config.yaml:/etc/hermes/config.yaml:ro" \
  "$ENGINE" sh -ec 'exec hermes gateway run' >/dev/null
# The sandbox's network is joined after the Engine's listeners are bound, so they are bound on the
# install network's address only (managed-config's ssh address is the one the Engine dials outward).
docker network connect --ip "$ENGINE_SANDBOX_IP" "$SANDBOX_NET" "$NAME-engine"

wait_for() {
  tries=$1; shift
  while [ "$tries" -gt 0 ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    tries=$((tries - 1))
    sleep 2
  done
  return 1
}
engine_ready() {
  docker exec "$NAME-engine" /opt/hermes/.venv/bin/python -c "
import urllib.request
request = urllib.request.Request('http://$ENGINE_IP:9119/api/profiles',
                                 headers={'Authorization': 'Bearer $KEY'})
urllib.request.urlopen(request, timeout=5)
urllib.request.urlopen('http://$ENGINE_IP:8642/health', timeout=5)"
}
wait_for 90 engine_ready || { docker logs "$NAME-engine" | tail -40; exit 1; }

# --- the probes, run inside the pinned Engine ---------------------------------------------------
docker exec "$NAME-engine" mkdir -p /opt/probe
docker cp "$HERE/provider.py" "$NAME-engine:/opt/probe/provider.py" >/dev/null
docker cp "$HERE/probe.py" "$NAME-engine:/opt/probe/probe.py" >/dev/null
docker exec -u 10000 -e API_SERVER_KEY="$KEY" -e PROBE_ENGINE_ADDRESS="$ENGINE_IP" \
  "$NAME-engine" /opt/hermes/.venv/bin/python /opt/probe/probe.py 2>&1

# --- host-side checks: where each marker landed ------------------------------------------------
say ""
say "20 where each marker a tool wrote is found"
for file in /tmp/gw390-terminal.txt /tmp/gw390-background.txt /work/gw390-file.txt \
            /work/gw390-code.txt /tmp/gw390-browser.txt \
            /opt/data/profiles/probe-other/memories/MEMORY.mp3; do
  in_sandbox=$(docker exec "$NAME-sbx" sh -c "test -f $file && echo yes || echo no")
  on_engine=$(docker exec "$NAME-engine" sh -c "test -f $file && echo yes || echo no")
  say "20 $file: second container=$in_sandbox engine=$on_engine"
done
say "20 /work/sandbox-only.txt: second container=$(docker exec "$NAME-sbx" sh -c 'test -f /work/sandbox-only.txt && echo yes || echo no') engine=$(docker exec "$NAME-engine" sh -c 'test -f /work/sandbox-only.txt && echo yes || echo no')"
say "20 another Agent's memory file after the speech attempt: $(docker exec "$NAME-engine" sh -c 'head -c 120 /opt/data/profiles/probe-other/memories/MEMORY.md | tr -d "\n"')"
say "20 the model sign-in after the speech attempt: $(docker exec "$NAME-engine" sh -c 'head -c 70 /opt/data/auth.json | tr -d "\n"')"

# --- the Engine's two listeners from the second container's network -----------------------------
say ""
say "21 the Engine's listeners, reached from the second container's network"
docker cp "$HERE/reach.py" "$NAME-sbx:/tmp/reach.py" >/dev/null
docker exec "$NAME-sbx" python3 /tmp/reach.py "$ENGINE_SANDBOX_IP" "$ENGINE_IP" 2>&1

# --- the control: the same two networks, a listener on the wildcard address ---------------------
docker run -d --name "$NAME-control" --network "$INSTALL_NET" "$IMAGE" >/dev/null
docker network connect --ip 172.31.241.12 "$SANDBOX_NET" "$NAME-control"
docker exec -d "$NAME-control" python3 -m http.server 8642 --bind 0.0.0.0
sleep 2
say "22 the same two networks with a listener on 0.0.0.0 (control): $(docker exec "$NAME-sbx" python3 -c "
import socket,sys
s=socket.socket(); s.settimeout(4)
try:
    s.connect(('172.31.241.12', 8642)); print('open')
except Exception as e:
    print(type(e).__name__)
finally:
    s.close()")"

say ""
say "probe finished; everything it made is removed"
