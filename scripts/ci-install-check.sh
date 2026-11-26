#!/usr/bin/env bash
# The install proof, one command of the repo (#402): each CI install job runs this file for its area on an isolated
# Docker machine and holds no check of its own, and `./ci.sh install [area]` starts such a machine here and runs it.
# Without an area every area (spec #401's seven, `rollback` and `engines-update`, #389, and those named below) run one after another, then the profile-size measurement; with one, only
# that area runs, on a fresh Docker machine: `first-install` (the first install and its repeat), `companies` (Companies
# and their Engines), `agents` (Agents on their Engines), `backup` (backup and restore), `proxy` (the public address
# behind a proxy), `rollback` (a failed update rolled back), `update` (the update between releases), `previous-archive` (the previous release's own archive restored), `release-update` (the latest published release, read
# from the releases list, updated to this one, #483), `sandbox-update`
# (an install the release before the work sandbox made, updated to this one, #397), `staged-update` (the staged removal of
# Agent levels: updates that fail after its first step, then the cutover, ADR 0023), `sizes` (the measured
# sizes and the default sandbox limits a render finishes within, #400), `engines-update` (a release that pins another Engine image), `one-line` (the one-line install) and `measure` (the
# profile-size measurement, on a push to main and a manual run only, never on a pull request, #408). Every area makes
# the install, its first run, the Companies, the archives, the local registry and the release files it needs itself
# (#406–#409), so no area needs another to have run. The helpers the areas share are in scripts/ci-install-lib.sh,
# sourced below, so each is written once.
# DOCKER_HOST names that machine; RUNNER_TEMP is a scratch folder; INSTALL_REF and GH_TOKEN come from CI or ci.sh
# (GH_TOKEN only reaches the update's source download, scripts/install.sh, and the release-update area's releases list,
# scripts/latest-release.mjs).
set -e
# An install piped into tee keeps its own exit status.
set -o pipefail
root=$PWD
# shellcheck source=scripts/ci-install-lib.sh
. "$(dirname "$0")/ci-install-lib.sh"
# The step each area ran in before the move names its failure (#402); each area's start sets it and the summary trap
# (area_setup, scripts/ci-install-lib.sh), so no area carries another one's.

# first-install: the first install and its repeat: the setup link, .env.install and its permissions, the first Company
# and its Engine, health, the database checks and the worker's own reach. What a backup must bring back and the backup
# and restore themselves are the backup area's (#409).
first_install() {
cd "$root"
area_setup
reset_install
install_source first-install.log || fail 'first install'
# The work sandbox image every Company's sandbox runs (#392, ADR 0020): the source install built it from
# sandbox/Dockerfile (or CI loaded it), and its own check proves in a container of it what an install owner and an Agent see.
[[ -f .work-sandbox-image ]] || fail 'the install names the work sandbox image it got'
node scripts/check-work-sandbox.mjs --image "$(cat .work-sandbox-image)" | tee work-sandbox.log || fail 'the work sandbox image'
grep -qx 'work sandbox: ok' work-sandbox.log || fail 'the work sandbox image prints "work sandbox: ok"'
# The pinned Engine's file-sync switch (#393): its cont-init hook patches the Engine's own copy to take
# terminal.ssh_sync_files, and fails when the pinned text is not there. In a throwaway container of the pinned image with
# the managed configuration, the hook runs twice (as a restarted Engine runs it) and the ssh environment a profile's
# terminal builds gets sync_files off, even when the profile's own config asks for it on.
engine_image=$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)
docker run --rm -v "$PWD/scripts/engine-ssh-sync-files.sh:/hook:ro" -v "$PWD/scripts/engine-managed.yml:/etc/hermes/config.yaml:ro" \
  --entrypoint /bin/sh "$engine_image" -ec '/hook; /hook; cd /opt/hermes; exec python - <<"PY"
import pathlib, tempfile
from unittest.mock import MagicMock
home = pathlib.Path(tempfile.mkdtemp())
(home / "config.yaml").write_text("terminal: {ssh_sync_files: true}\n")
from tools.terminal_scope import build_profile_terminal_scope, set_terminal_scope
set_terminal_scope(build_profile_terminal_scope(home))
from tools import terminal_tool_backends
from tools.terminal_tool import _get_env_config
from tools.terminal_tool_lifecycle import _create_configured_env
terminal_tool_backends._SSHEnvironment = built = MagicMock()
config = _get_env_config()
_create_configured_env(config, config["env_type"], image="", cwd="/work", timeout=30, task_id="sync-check", host_cwd=None)
assert config["env_type"] == "ssh" and built.call_args.kwargs["sync_files"] is False, built.call_args
PY' || fail 'the pinned Engine builds its ssh sandbox with file sync off'
# A ChatGPT sign-in from Settings adds its account (#618): the cont-init hook patches the dashboard's device-code save.
# In a throwaway container of the pinned image the hook runs twice, and the save the worker calls keeps a second account
# beside the first, renews an account signed in again in place (same id), removes the second alone with the first still
# signed in, and, after every account was removed from the pool, lists the next sign-in again. Tokens are unsigned test JWTs; nothing reaches OpenAI.
docker run --rm -u root -e HERMES_HOME=/tmp/codex-accounts -v "$PWD/scripts/engine-codex-accounts.sh:/hook:ro" \
  --entrypoint /bin/sh "$engine_image" -ec '/hook; /hook; mkdir -p "$HERMES_HOME"; cd /opt/hermes; exec python - <<"PY"
import asyncio, base64, json
from hermes_cli.web_routers import oauth, ops
from agent.credential_pool import load_pool
part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
jwt = lambda who, n="": part({"alg": "none"}) + "." + part({"sub": who, "https://api.openai.com/auth": {"chatgpt_account_id": who}}) + ".t" + n
rows = lambda: [(e.id, e.source, e.access_token) for e in load_pool("openai-codex").entries()]
oauth._gtmworks_save_codex_login({"access_token": jwt("a"), "refresh_token": "r"})
oauth._gtmworks_save_codex_login({"access_token": jwt("b"), "refresh_token": "r"})
two = rows()
assert [s for _, s, _ in two] == ["device_code", "manual:device_code"], two
oauth._gtmworks_save_codex_login({"access_token": jwt("b", "2"), "refresh_token": "r"})
again = rows()
assert [i for i, _, _ in again] == [i for i, _, _ in two] and again[1][2] == jwt("b", "2") and again[0][2] == jwt("a"), again
oauth._gtmworks_save_codex_login({"access_token": jwt("a", "3"), "refresh_token": "r"})
again = rows()
assert [i for i, _, _ in again] == [i for i, _, _ in two] and again[0][2] == jwt("a", "3"), again
from hermes_cli.auth import get_codex_auth_status
asyncio.run(ops.remove_credential_pool_entry("openai-codex", 2, None))
assert rows() == again[:1] and get_codex_auth_status().get("logged_in") is True, rows()
asyncio.run(ops.remove_credential_pool_entry("openai-codex", 1, None))
assert rows() == []
oauth._gtmworks_save_codex_login({"access_token": jwt("c"), "refresh_token": "r"})
assert [s for _, s, _ in rows()] == ["device_code"], rows()
PY' || fail 'a second ChatGPT sign-in adds its own account to the pinned Engine'
# A request goes on, in the Owner's order, on the next account switched on when one runs out (#621): the cont-init hook
# patches the pool's order, its switch-off and a record of each move. In a throwaway container of the pinned image, after
# the accounts hook as the Engine runs them, the hook runs twice, and scripts/check-engine-pool-order.py proves on the
# root that the order and the switch are kept and followed and one usage-limit failure moves the request once, then on
# an Agent's profile that it borrows the root's accounts in that order, its move recorded in the root's home. It runs
# with no network: nothing it does reaches OpenAI.
docker run --rm -u root --network none -v "$PWD/scripts/engine-codex-accounts.sh:/etc/cont-init.d/07-engine-codex-accounts:ro" \
  -v "$PWD/scripts/engine-pool-order.sh:/hook:ro" -v "$PWD/scripts/check-engine-pool-order.py:/check.py:ro" \
  --entrypoint /bin/sh "$engine_image" -ec '/etc/cont-init.d/07-engine-codex-accounts; /hook; /hook; cd /opt/hermes
mkdir -p /tmp/pool/profiles/ag-check; export HERMES_HOME=/tmp/pool
.venv/bin/python /check.py root; HERMES_HOME=/tmp/pool/profiles/ag-check .venv/bin/python /check.py borrowed
.venv/bin/python /check.py recorded; [ ! -e /tmp/pool/profiles/ag-check/auth.json ]' \
  || fail 'the pinned Engine follows the Owner'"'"'s account order and records each move'
[[ $(stat -c %a .env.install) == 600 ]] || fail '.env.install permissions (expected 600)'
# First run opens only through the setup link (issue #50): the first install ends with it, its code is in no
# other line, and a repeat install while setup is still open prints the same link. The code travels after `#`
# (Omar, 2026-11-12), never in a query string, so no request line and no gateway log can carry it.
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
[[ $code =~ ^[a-f0-9]{64}$ ]] || fail 'the install generates a setup code'
link="Set up gtmworks with this one-time link: http://localhost:3000/first-run#code=$code"
[[ $(tail -n 1 first-install.log) == "$link" ]] || fail 'the first install ends with the setup link'
[[ $(grep -cF "$code" first-install.log) == 1 ]] || fail 'the setup code appears only in the setup link'
if grep -qF '?code=' first-install.log; then fail 'no link carries the setup code in its query string'; fi
gateway_id=$(compose ps -q gateway) && [[ -n $gateway_id ]] || fail 'the first install runs the gateway'
{ sh scripts/install.sh || fail 'repeat install before setup'; } 2>&1 | tee repeat-before-setup.log
[[ $(compose ps -q gateway) == "$gateway_id" ]] || fail 'a repeat install before setup keeps the unchanged gateway container'
[[ $(tail -n 1 repeat-before-setup.log) == "$link" ]] || fail 'a repeat install before setup prints the same setup link'
# The local install on http://localhost:3000, straight to the gateway, while first run is still open: the emailed
# sign-in link reaches the Company home, an invitation link returns to the app, and a sign-in request with a forged
# X-Forwarded-Host still gets a link on APP_ORIGIN (issue #40). Every other area completes the same first run (#407).
complete_setup || fail 'emailed sign-in and invitation links on the local install'
# That check opened first run and completed setup with the code in the submit body: the gateway's access log holds
# those requests and not the code.
gateway_logs=$(compose logs gateway 2>&1) || fail 'read gateway logs'
grep -qF 'POST /first-run/submit' <<< "$gateway_logs" || fail 'the gateway access log holds the setup requests'
if grep -qF "$code" <<< "$gateway_logs"; then fail 'the setup code must not appear in the gateway access log'; fi
logs=$(compose logs 2>&1) || fail 'read container logs'
if grep -qF "$code" <<< "$logs"; then fail 'the setup code must not appear in a container log'; fi
# The first Company's Engine is answered from its record, not the app's environment (#380), and the key is kept
# encrypted only: a node call with the install's environment pointing elsewhere still reaches the record's Engine.
company_id=$(db -c "select id from public.companies where name='Proxy Company'") || fail 'read the first Company'
[[ -n $company_id ]] || fail 'first run made the first Company'
engine_key=$(first_engine_key)
# The Engine's key is in the Engine's own file, owner-only, and never in the install's environment file (#385).
[[ $engine_key =~ ^[a-f0-9]{64}$ && $(stat -c %a .engines/first/.env) == 600 ]] || fail 'the Engine key is in .engines/first/.env'
if grep -q '^HERMES_API_KEY=' .env.install; then fail '.env.install holds no Engine key'; fi
# The app and the worker hold only the values they read (#446): neither the database password, pgsodium's root key nor
# the JWT secret is in their environment, by name or by value, while they still answer.
for service in web worker; do
  environment=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(compose ps -q "$service")") || fail "inspect the $service container"
  for name in POSTGRES_PASSWORD PGSODIUM_ROOT_KEY SUPABASE_JWT_SECRET; do
    value=$(sed -n "s/^$name=//p" .env.install)
    [[ $value =~ ^[a-f0-9]{64}$ ]] || fail ".env.install holds $name"
    if grep -q "^$name=" <<< "$environment" || grep -qF "$value" <<< "$environment"; then fail "the $service container holds no $name"; fi
  done
  grep -q '^SUPABASE_SERVICE_ROLE_KEY=' <<< "$environment" || fail "the $service container holds the service-role key it reads"
done
[[ $(db -c "select key_encrypted from public.company_engines where id=(select engine_id from public.companies where id='$company_id')") != "$engine_key" ]] || fail 'the Engine key is stored in plaintext'
compose exec -T -e EXPECTED_KEY="$engine_key" web \
  node --input-type=module -e "const {engineOf}=await import('/app/lib/company-engine.mjs'); const at=await engineOf('$company_id'); console.log(at?.address==='$engine_address'&&at?.key===process.env.EXPECTED_KEY?'record':'no');" \
  | grep -qx record || fail "the first Company's Engine is answered from its record"
if grep -qF "$engine_key" <<< "$logs"; then fail 'the Engine key must not appear in a container log'; fi
# The first Company's Engine is the template's own Compose project (ADR 0018): its own container, volume and
# network, no host port, and the pinned image. The app and the worker join its network; it joins its own network and its
# Company's work network, nothing else.
engine_id=$(first_engine_id) || fail 'the first Engine container'
[[ -n $engine_id ]] || fail 'the first Engine container'
[[ $(docker inspect -f '{{.Config.Image}}' "$engine_id") == $(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1) ]] || fail 'the Engine runs the template image'
! publishes_host_port "$engine_id" || fail 'the Engine publishes no host port'
# The Engine joins the install network and its Company's work network, and nothing else (#393).
engine_networks=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$engine_id" | grep . | sort)
[[ $engine_networks == $'gtmworks-engine-first\ngtmworks-work-first' ]] || fail "the Engine joins its install network and its work network only (got: $engine_networks)"
for service in web worker; do
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$(compose ps -q "$service")" | grep -qx gtmworks-engine-first \
    || fail "the $service joins the Engine's network"
  if docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' "$(compose ps -q "$service")" | grep -qx gtmworks-work-first; then
    fail "the $service stays off the work network"
  fi
done
# The first Company's work sandbox (#393): the image the install recorded, running and healthy, on the Company's own work
# network, which is internal (its one way out is the exit below, #394), with its work volume mounted at /work.
sandbox_id=$(docker ps -q --filter 'name=^gtmworks-sandbox-first$') || fail 'the first sandbox container'
[[ -n $sandbox_id ]] || fail 'the first sandbox container'
[[ $(docker inspect -f '{{.Config.Image}}' "$sandbox_id") == "$(cat .work-sandbox-image)" ]] || fail 'the sandbox runs the image the install recorded'
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox_id") == healthy ]] || fail 'the sandbox is healthy'
[[ $(docker network inspect gtmworks-work-first -f '{{.Internal}}') == true ]] || fail "the sandbox's network has no way out"
! publishes_host_port "$sandbox_id" || fail 'the sandbox publishes no host port'
[[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Name}}{{end}}{{end}}' "$sandbox_id") == gtmworks-work-first ]] || fail "the Company's work folder is the sandbox's own volume"
[[ $(docker exec "$sandbox_id" id -un) == pn ]] || fail 'the sandbox runs as its own ordinary user'
# From the Engine's network nothing else of the install is reachable (db, auth, REST, storage, the gateway), and a
# request to the app there buys nothing with a forged visitor address.
docker run --rm --network gtmworks-engine-first -e INSTALL_SERVICE_IPS="$(install_service_ips)" -v "$PWD/scripts:/check:ro" \
  node:22.14.0-alpine3.21 node /check/check-install-engine-network.mjs \
  || fail "the Engine network reaches no install service, by name or address, and trusts no forged address"
# From the Company's work network, where its Agents' code runs, the install is unreachable too, and the Engine answers on
# its install-network address only: it binds its listeners there and nowhere else (#390, #393).
[[ $(docker network inspect gtmworks-work-first -f '{{range .Containers}}{{println .Name}}{{end}}' | grep . | sort) == $'gtmworks-engine-first\ngtmworks-exit-first\ngtmworks-sandbox-first' ]] \
  || fail 'the work network holds exactly its Engine, its sandbox and its exit'
work_engine_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$engine_id")
work_web_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$(compose ps -q web)")
docker run --rm --network gtmworks-work-first -e INSTALL_SERVICE_IPS="$(install_service_ips),web=$work_web_ip" -e ENGINE_WORK_IP="$work_engine_ip" \
  -e ENGINE_WORK_PORTS="$(engine_listen_ports "$engine_id")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-work-network.mjs \
  || fail 'the work network reaches no install service and no Engine listener'
# No container of the install mounts the server's Docker socket: the Engine cannot take the server.
if docker ps -aq | xargs -r docker inspect -f '{{.Name}} {{range .Mounts}}{{.Source}} {{end}}' | grep -q 'docker.sock'; then
  fail 'no container of the install mounts the Docker socket'
fi
# The sandbox's one way out (#394): the Company's exit, made from the same template with the sandbox and from the same
# image, is the only container on the work network with a network that routes out. It runs as the image's ordinary user
# with no capability, no new privilege, no volume of the install and no port, on its work network and its own outbound network only,
# and it listens on the work network alone.
exit_id=$(docker ps -q --filter 'name=^gtmworks-exit-first$') || fail 'the first exit container'
[[ -n $exit_id ]] || fail 'the first exit container runs'
[[ $(docker inspect -f '{{.Config.Image}}' "$exit_id") == "$(cat .work-sandbox-image)" ]] || fail 'the exit runs the work sandbox image, as the sandbox does'
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$exit_id") == healthy ]] || fail 'the exit is healthy'
[[ $(docker exec "$exit_id" id -u) == 1000 ]] || fail 'the exit runs as an ordinary user, never root'
[[ $(docker inspect -f '{{join .HostConfig.CapDrop ","}}' "$exit_id") == ALL ]] || fail 'the exit drops every capability'
[[ $(docker inspect -f '{{join .HostConfig.SecurityOpt ","}}' "$exit_id") == *no-new-privileges* ]] || fail 'the exit has no new privileges'
# The only mounts are anonymous volumes the image itself may declare: no folder of the server and no volume of the
# install. The port the image exposes for its sshd is listed unpublished; no host port is bound.
exit_mounts=$(docker inspect -f '{{range .Mounts}}{{println .Type .Name}}{{end}}' "$exit_id" | grep . || true)
[[ -z $(grep -Ev '^volume [0-9a-f]{64}$' <<< "$exit_mounts") ]] && ! publishes_host_port "$exit_id" \
  || fail "the exit mounts no folder and no volume of the install, and publishes no port (mounts: $exit_mounts)"
[[ $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$exit_id" | grep . | sort) == $'gtmworks-exit-first\ngtmworks-work-first' ]] \
  || fail 'the exit joins the work network and its own outbound network only'
[[ $(docker network inspect gtmworks-exit-first -f '{{.Internal}}') == false ]] || fail "the exit's own network routes out"
[[ $(docker network inspect gtmworks-exit-first -f '{{range .Containers}}{{println .Name}}{{end}}' | grep . | sort) == gtmworks-exit-first ]] || fail "the exit's network holds the exit alone"
[[ $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$sandbox_id" | grep . | sort) == gtmworks-work-first ]] || fail 'the sandbox joins its work network only'
exit_outbound_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-exit-first").IPAddress}}' "$exit_id")
docker run --rm --network gtmworks-exit-first node:22.14.0-alpine3.21 node -e "const s=require('net').connect(3128,'$exit_outbound_ip');s.setTimeout(3000,()=>process.exit(0));s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));" \
  || fail 'the exit listens on the work network alone, never on the network that routes out'
# A stand-in public host outside the install's networks: an address reserved for documentation, added to the Docker
# machine itself, so the exit reaches it as it reaches the internet, out of its own network and through the machine. It
# answers HTTP and HTTPS (its certificate made here, in the sandbox image's openssl, and trusted by no one) with a token,
# and counts what reaches its raw TCP and UDP ports.
standin=203.0.113.80
docker run --rm --network host --cap-add NET_ADMIN node:22.14.0-alpine3.21 sh -c "ip addr add $standin/32 dev lo 2> /dev/null || ip addr show dev lo | grep -qF ' $standin/'" \
  || fail 'add the stand-in public address to the Docker machine'
standin_tls=$(docker run --rm --entrypoint sh "$(cat .work-sandbox-image)" -ec 'cd /tmp; openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=standin.exit.test -keyout key.pem -out cert.pem > /dev/null 2>&1; cat key.pem cert.pem') \
  || fail "make the stand-in host's certificate"
standin_token="exit-standin-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
docker rm -f exit-standin > /dev/null 2>&1 || true
docker run -d --name exit-standin --network host -e EXIT_HOST_ADDRESS="$standin" -e EXIT_HOST_TOKEN="$standin_token" \
  -e EXIT_HOST_KEY="$(sed -n '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/p' <<< "$standin_tls")" -e EXIT_HOST_CERT="$(sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' <<< "$standin_tls")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-exit-host.mjs > /dev/null || fail 'start the stand-in public host'
for attempt in $(seq 1 30); do docker logs exit-standin 2>&1 | grep -q 'stand-in host listening' && break; sleep 1; done
docker logs exit-standin 2>&1 | grep -q 'stand-in host listening' || { docker logs exit-standin >&2; fail 'the stand-in public host listens'; }
# Names that resolve, where the exit resolves them, to each refused range and to the stand-in: a record in the exit's
# own hosts file stands in for a DNS answer, so the exit is judged by the address a name gives it, never by the name.
db_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q db)")
engine_install_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$engine_id")
docker exec -i -u 0 "$exit_id" sh -c 'cat >> /etc/hosts' <<HOSTS || fail "add the probe names to the exit's resolver"
10.20.30.40 private.exit.test
172.16.5.6 private172.exit.test
192.168.7.8 private192.exit.test
fd00::1 ula.exit.test
100.64.0.1 shared.exit.test
169.254.1.1 link-local.exit.test
fe80::1 link-local6.exit.test
127.0.0.1 loopback.exit.test
::1 loopback6.exit.test
169.254.169.254 metadata.exit.test
fd00:ec2::254 metadata6.exit.test
100.100.100.200 metadata-shared.exit.test
$db_ip db.exit.test
$engine_install_ip engine.exit.test
$exit_outbound_ip exit-own.exit.test
$standin standin.exit.test
HOSTS
# What the sandbox must not reach directly, on any port that answers inside the install: every install service by name
# and by each of its addresses, the app and the worker on every network they join, the Engine's listeners on both its
# addresses, the exit's network-facing address and the stand-in host.
probe_direct=()
for pair in db:5432 auth:9999 rest:3000 storage:5000 gateway:8080 web:3000 web:8080 worker:80; do probe_direct+=("${pair%%:*} ${pair#*:}"); done
for service in db auth rest storage gateway web worker; do
  for address in $(addresses_of "$(compose ps -q "$service")" | tr , ' '); do
    for port in 80 3000 5000 5432 8080 9999; do probe_direct+=("$address $port"); done
  done
done
for port in $(engine_listen_ports "$engine_id" | tr , ' ') 22; do probe_direct+=("$engine_install_ip $port" "$work_engine_ip $port"); done
probe_direct+=("gtmworks-engine-first 8642" "gtmworks-engine-first 9119" "$exit_outbound_ip 3128")
direct_json=$(for item in "${probe_direct[@]}"; do printf '{"host":"%s","port":%s},' "${item% *}" "${item#* }"; done | sed 's/,$//')
# What the exit refuses, by number and by a name that resolves to it: private (RFC 1918 and ULA), shared, link-local,
# loopback (also as a decimal number and as an IPv4 address written in IPv6), the cloud metadata addresses, the install's
# own services and Engine, the sandbox's own network and the exit's own.
sandbox_work_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$sandbox_id")
refused_json=$(for host in 10.20.30.40 172.16.5.6 192.168.7.8 fd00::1 100.64.0.1 169.254.1.1 fe80::1 127.0.0.1 ::1 0.0.0.0 2130706433 ::ffff:127.0.0.1 \
  169.254.169.254 fd00:ec2::254 ::ffff:169.254.169.254 100.100.100.200 168.63.129.16 "$db_ip" "$engine_install_ip" "$work_engine_ip" "$sandbox_work_ip" "$exit_outbound_ip" \
  localhost private.exit.test private172.exit.test private192.exit.test ula.exit.test shared.exit.test link-local.exit.test link-local6.exit.test loopback.exit.test \
  loopback6.exit.test metadata.exit.test metadata6.exit.test metadata-shared.exit.test db.exit.test engine.exit.test exit-own.exit.test sandbox gtmworks-engine-first; do
  printf '"%s",' "$host"; done | sed 's/,$//')
# Through the exit, the install's own names reach nothing either: they do not resolve where the exit looks.
unreached_json=$(for pair in db:5432 auth:9999 rest:3000 storage:5000 gateway:8080 web:3000 worker:3000 gtmworks-engine-first:8642 gtmworks-engine-first:9119; do
  printf '{"host":"%s","port":%s},' "${pair%%:*}" "${pair#*:}"; done | sed 's/,$//')
probe_config=$(printf '{"direct":[%s],"publicName":"example.com","refused":[%s],"unreached":[%s],"standin":{"address":"%s","hosts":["%s","standin.exit.test"],"token":"%s","rawPort":2525,"udpPort":5353}}' \
  "$direct_json" "$refused_json" "$unreached_json" "$standin" "$standin" "$standin_token" | base64 -w0)
sandbox_exit_probe "$engine_id" "$probe_config" | tee sandbox-exit.log || { docker logs --tail 80 "$exit_id" >&2; fail 'from the sandbox only HTTP and HTTPS to a public address leave, through the exit'; }
[[ $(docker run --rm --network host curlimages/curl:8.12.1 -sS "http://$standin/count") == '{"raw":0,"udp":0}' ]] \
  || fail 'no connection and no datagram from the sandbox reached the stand-in host but HTTP and HTTPS'
# Read once: grep -q ending a pipe early would fail it under pipefail.
exit_log=$(docker logs "$exit_id" 2>&1) || fail "read the exit's log"
grep -qx 'exit: refused (cloud metadata) 169.254.169.254:443' <<< "$exit_log" || fail "the exit's log names what it refused"
for line in "refused (port) $standin:2525" "refused (port) $standin:8443" "refused (not TLS) $standin:443"; do
  grep -qxF "exit: $line" <<< "$exit_log" || fail "the exit's log names what it refused: $line"
done
if grep -qF "$standin_token" <<< "$exit_log"; then fail "the exit's log holds no page it carried"; fi
docker rm -f exit-standin > /dev/null || true
# The repeat install leaves the settings file as it was, so keep a copy to compare after it. The data a restore must
# bring back is the backup area's (#409); an archive in the shape the release before this one made is made by that
# release's own installer in the update area, not repacked from this install's database (#378, C3).
cp .env.install .env.install.before
# A repeat install starts the Engine again, so its sandbox is prepared again: the container and the key pair stay.
sandbox_id_before=$sandbox_id
sandbox_public_before=$(sandbox_public_of "$(engine_value .engines/first VOLUME)") || fail "the first Engine's sandbox key"
# A Company names its Engine record (#382): the probe makes its own waiting record and the Company on it.
db -c "with e as (insert into public.company_engines (id,address,key_encrypted) values ('00000000-0000-4000-8000-000000000236','$engine_address','install-probe') returning id) insert into public.companies (id,slug,name,engine_id) select '00000000-0000-4000-8000-000000000237','install-probe','Keep me',id from e;" || fail 'insert persistence probe'
db -c 'select name from gtmworks_install.schema_migrations order by name' > before || fail 'read initial migrations'
find supabase/migrations -name '*.sql' ! -name '*.verify.sql' -printf '%f\n' | sort > expected
diff -u expected before || fail 'applied migrations match migration files'
{ sh scripts/install.sh || fail 'repeat install'; } 2>&1 | tee repeat-after-setup.log
[[ $(tail -n 1 repeat-after-setup.log) == 'gtmworks is ready: http://localhost:3000/sign-in' ]] || fail 'a repeat install after setup prints the sign-in address'
if grep -qF "$code" repeat-after-setup.log; then fail 'a repeat install after setup prints no setup code'; fi
[[ $(compose ps -q gateway) == "$gateway_id" ]] || fail 'a repeat install after setup keeps the unchanged gateway container'
if grep -qF 'gateway-1 Recreate' repeat-before-setup.log repeat-after-setup.log; then fail 'a repeat install leaves the unchanged gateway running under the worker'; fi
cmp .env.install.before .env.install || fail '.env.install unchanged after repeat install'
[[ $(docker ps -q --filter 'name=^gtmworks-sandbox-first$') == "$sandbox_id_before" ]] || fail 'a repeat install keeps the sandbox container'
[[ $(sandbox_public_of "$(engine_value .engines/first VOLUME)") == "$sandbox_public_before" ]] || fail 'a repeat install keeps the sandbox key pair'
# The Engine restarted by the repeat install still binds every listener to its install-network address alone: the same
# work-network check runs again, over every port the Engine listens on, read from inside it (#393).
engine_id=$(first_engine_id) || fail 'the first Engine container after a repeat install'
work_engine_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$engine_id")
work_web_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$(compose ps -q web)")
docker run --rm --network gtmworks-work-first -e INSTALL_SERVICE_IPS="$(install_service_ips),web=$work_web_ip" -e ENGINE_WORK_IP="$work_engine_ip" \
  -e ENGINE_WORK_PORTS="$(engine_listen_ports "$engine_id")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-work-network.mjs \
  || fail 'after a repeat install the work network reaches no install service and no Engine listener'
db -c 'select name from gtmworks_install.schema_migrations order by name' > after || fail 'read migrations after repeat install'
diff -u before after || fail 'migrations unchanged after repeat install'
[[ $(db -c "select name from public.companies where slug='install-probe'") == 'Keep me' ]] || fail 'company preserved after repeat install'
for path in /api/health /sign-in /favicon.ico /manifest.webmanifest /apple-icon.png /icons/icon-192.png /icons/icon-512.png /icons/icon-maskable-512.png; do
  # The install machine is DinD; its published loopback port lives in that network namespace. The rest are the
  # gtmworks mark, its manifest and the icons the manifest names, which a browser asks for with no session (#453).
  status=$(docker run --rm --network host curlimages/curl:8.12.1 \
    -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request on install host port 3000"
  [[ $status == 200 ]] || fail "$path returned HTTP $status (expected 200)"
done
for file in supabase/migrations/*.verify.sql scripts/check-rls.sql; do
  result=$(compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' db \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At < "$file") || fail "execute $file"
  printf '[%s]\n' "$result" | docker run --rm -i -v "$PWD/scripts:/scripts:ro" \
    node:22.14.0-alpine3.21 node /scripts/verify-db.mjs "$file" || fail "database verification: $file"
done
[[ $(compose exec -T worker node -e 'console.log(process.pid>0)') == true ]] || fail 'worker process running'
worker_logs=$(compose logs worker) || fail 'read worker logs'
if grep -q 'Conversation runs worker:' <<< "$worker_logs"; then fail 'worker reaches the database'; fi
}

# companies: Companies and their Engines (#382, ADR 0018): the first Engine answering an Arabic message, `company add`
# and its refusals, one Company per Engine with its own key, network and volume, the first-Owner link, and the lists and
# reports a person reads. The area makes the install it needs itself (#407): a fresh install and its first run completed
# as first_install does it, so no earlier area is needed or kept.
companies() {
cd "$root"
area_setup
reset_install
install_source companies-install.log || fail 'the Companies area install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
engine_key=$(first_engine_key)
[[ $engine_key =~ ^[a-f0-9]{64}$ ]] || fail 'the Engine key is in .engines/first/.env'
# The first Company's Engine is the template's own container (ADR 0018): no host port, and an Arabic message gets
# its reply with no manual connection step. A fake model provider served from the web container stands in for a
# subscription.
engine_id=$(first_engine_id) || fail 'the Engine container'
[[ -n $engine_id ]] && ! publishes_host_port "$engine_id" || fail 'the Engine publishes no host port'
point_engine_at_fake_model "$engine_id"
# `gtmworks company add` (#382, ADR 0018): an email no Person has is refused before anything is made; an Engine
# that never becomes healthy leaves nothing behind and says so in one line; the same command again makes the
# second Company on its own Engine, with the existing Person as its Owner.
if sh scripts/install.sh company add --name 'No Owner' --owner nobody@example.com > company-unknown.log 2>&1; then
  fail 'company add must refuse an email no Person has'
fi
cat company-unknown.log
grep -Fq 'No Person on this install has the email nobody@example.com. Nothing was created.' company-unknown.log || fail 'the refusal names the email and says nothing was made'
[[ $(ls -d .engines/* | wc -l) == 1 ]] || fail 'the refused add made no Engine folder'
[[ $(db -c "select count(*) from public.companies where name='No Owner'") == 0 ]] || fail 'the refused add made no Company'
[[ $(db -c "select count(*) from public.company_engines where address like '%no-owner%'") == 0 ]] || fail 'the refused add made no Engine record'
# A failed add leaves nothing of the Company behind (#396): no Engine, sandbox or exit container, no volume (the Engine's
# data with its key, the work folder, the host key), no network, no folder with its key file, and no record.
nothing_left() {
  [[ $(ls -d .engines/* | wc -l) == 1 ]] || fail "$1 removed its Engine folder and the key in it"
  if docker ps -aq --filter 'name=^gtmworks-engine-' | while read -r id; do docker inspect -f '{{.Name}}' "$id"; done | grep -vq '^/gtmworks-engine-first$'; then fail "$1 left an Engine container"; fi
  [[ $(docker volume ls -q --filter 'name=^gtmworks-engine' | wc -l) == 0 ]] || fail "$1 left an Engine volume"
  [[ $(docker network ls -q --filter 'name=^gtmworks-engine' | wc -l) == 1 ]] || fail "$1 left an Engine network"
  [[ -z $(docker ps -aq --filter 'name=^gtmworks-sandbox-second-company-') ]] || fail "$1 left a sandbox container"
  if docker volume ls -q | grep -Eq '^gtmworks-(work|sandbox-hostkey)-second-company-'; then fail "$1 left a sandbox volume"; fi
  if docker network ls --format '{{.Name}}' | grep -q '^gtmworks-work-second-company-'; then fail "$1 left a work network"; fi
  [[ -z $(docker ps -aq --filter 'name=^gtmworks-exit-second-company-') ]] || fail "$1 left an exit container"
  [[ -z $(docker ps -aq --filter 'name=^gtmworks-screen-driver-second-company-') ]] || fail "$1 left the Screen driver's container"
  if docker network ls --format '{{.Name}}' | grep -q '^gtmworks-exit-second-company-'; then fail "$1 left an exit's network"; fi
  [[ $(db -c "select count(*) from public.companies where name='Second Company'") == 0 ]] || fail "$1 left no Company"
  [[ $(db -c "select count(*) from public.company_engines where address like '%second-company%'") == 0 ]] || fail "$1 left no Engine record"
}
if GTMWORKS_ENGINE_WAIT=1 second_company > company-failed.log 2>&1; then
  cat company-failed.log; docker compose version
  fail 'company add with an Engine that never becomes healthy must fail'
fi
cat company-failed.log
grep -Fq 'Company "Second Company" was not made: its Engine or its work sandbox did not start. Nothing was left behind; run the same command again.' company-failed.log || fail 'a failed Engine is one plain line'
nothing_left 'the failed add'
# A sandbox Docker will not start (more CPUs than the machine has) is taken back with its Engine, in the same one line.
if second_company scripts/install.sh --cpus 512 > company-sandbox-failed.log 2>&1; then
  cat company-sandbox-failed.log
  fail 'company add with a sandbox that cannot start must fail'
fi
cat company-sandbox-failed.log
grep -Fq 'Company "Second Company" was not made: its Engine or its work sandbox did not start. Nothing was left behind; run the same command again.' company-sandbox-failed.log || fail 'a failed sandbox is one plain line'
nothing_left 'the add whose sandbox did not start'
# Running it again, on an Engine that becomes healthy, succeeds, with the memory and CPU limit it is given (#396).
second_company scripts/install.sh --memory 1536m --cpus 1.5 || fail 'company add makes the second Company'
second_folder=$(ls -d .engines/* | grep -v '/first$')
second_container=$(engine_value "$second_folder" NAME)
second_network=$(engine_value "$second_folder" NETWORK)
second_key=$(engine_value "$second_folder" KEY)
second_address=http://$second_container:8642
second_company=$(db -c "select id from public.companies where name='Second Company'") || fail 'read the second Company'
[[ -n $second_company ]] || fail 'the second Company exists'
[[ $(db -c "select count(*) from public.company_engines where id=(select engine_id from public.companies where name='Second Company') and address='$second_address'") == 1 ]] || fail 'the second Company names its own Engine record'
[[ $(db -c "select m.role from public.members m join public.companies c on c.id=m.company_id join auth.users u on u.id=m.person_id where c.name='Second Company' and u.email='proxy-owner@example.com'") == owner ]] || fail "the existing Person is the second Company's Owner"
# The second Engine is the template's own: pinned image, its own volume, key and network, no host port, and the
# app and the worker join its network.
[[ $(docker inspect -f '{{.Config.Image}}' "$second_container") == *'nousresearch/hermes-agent:v0.23.0@sha256:'* ]] || fail 'the second Engine runs the pinned Hermes image'
! publishes_host_port "$second_container" || fail 'the second Engine publishes no host port'
second_sandbox=$(printf '%s' "$second_container" | sed 's/^gtmworks-engine-/gtmworks-sandbox-/')
second_work_network=$(printf '%s' "$second_container" | sed 's/^gtmworks-engine-/gtmworks-work-/')
[[ $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$second_container" | grep . | sort) == $(printf '%s\n' "$second_network" "$second_work_network" | sort) ]] || fail 'the second Engine joins its own network and its work network only'
for service in web worker; do
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$(compose ps -q "$service")" | grep -qx "$second_network" \
    || fail "the $service joins the second Engine's network"
  if docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' "$(compose ps -q "$service")" | grep -qx "$second_work_network"; then
    fail "the $service stays off the second work network"
  fi
done
# #773: the installer names every Engine's network for the app and the worker in its own Compose file, so recreating
# them outside the installer, as an Owner's own Compose command does, leaves both on each Engine's network.
grep -qx "  $second_network:" docker-compose.engines.yml || fail "the installer's Compose file names the second Engine's network"
# Only the file's own top-level networks block names networks; its services block names web and worker the same way.
engine_networks=$(sed -n '/^networks:$/,$s/^  \([^ :]*\):$/\1/p' docker-compose.engines.yml | sort -u)
docker compose --env-file .env.install -f docker-compose.install.yml -f docker-compose.engines.yml up -d --no-deps --force-recreate --wait --wait-timeout 300 web worker \
  || fail 'the app and the worker recreated outside the installer'
for service in web worker; do
  for network in $engine_networks; do
    docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$(compose ps -q "$service")" | grep -qx "$network" \
      || fail "the recreated $service stays on the Engine network $network"
  done
done
docker exec "$(compose ps -q web)" node -e "fetch('http://$second_container:8642/health',{signal:AbortSignal.timeout(5000)}).then(response=>process.exit(response.ok?0:1),()=>process.exit(1))" \
  || fail 'the recreated app reaches the second Engine'
# From inside the second Engine's network the first Engine cannot be reached, and neither can any install service.
docker run --rm --network "$second_network" node:22.14.0-alpine3.21 node --input-type=module -e "try { await fetch('http://gtmworks-engine-first:8642/health',{signal:AbortSignal.timeout(5000)}); process.exit(1); } catch { console.log('the other Engine is unreachable'); }" || fail 'one Engine cannot reach another'
docker run --rm --network "$second_network" -e INSTALL_SERVICE_IPS="$(install_service_ips)" -v "$PWD/scripts:/check:ro" \
  node:22.14.0-alpine3.21 node /check/check-install-engine-network.mjs || fail 'the second Engine network reaches no install service'
# The second Company's work network is its own: the first Company's Engine and its sandbox, and every install service,
# are unreachable from it.
second_exit=$(exit_of "$second_container")
[[ $(docker network inspect "$second_work_network" -f '{{range .Containers}}{{println .Name}}{{end}}' | grep . | sort) == $(printf '%s\n' "$second_container" "$second_sandbox" "$second_exit" | sort) ]] \
  || fail 'the second work network holds exactly its Engine, its sandbox and its exit'
second_work_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$second_work_network\").IPAddress}}" "$second_container")
second_web_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-install_default").IPAddress}}' "$(compose ps -q web)" 2> /dev/null || true)
second_web_ip=${second_web_ip:-$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q web)")}
docker run --rm --network "$second_work_network" -e INSTALL_SERVICE_IPS="$(install_service_ips),web=$second_web_ip" -e ENGINE_WORK_IP="$second_work_ip" -e OTHER_ENGINES="gtmworks-engine-first" \
  -e ENGINE_WORK_PORTS="$(engine_listen_ports "$second_container")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-work-network.mjs \
  || fail 'the second work network reaches no install service, no other Engine and no listener of its own Engine'
# From inside the second sandbox, as its Agents' commands run (#394): the first Company's sandbox, Engine and exit are
# reached neither directly nor through the second Company's own exit, by name or by address.
first_engine_ips=$(addresses_of gtmworks-engine-first)
first_sandbox_ip=$(addresses_of gtmworks-sandbox-first)
first_exit_ips=$(addresses_of gtmworks-exit-first)
other_direct=$(for item in gtmworks-sandbox-first:2222 gtmworks-engine-first:8642 gtmworks-engine-first:9119 gtmworks-exit-first:3128 \
  "$first_sandbox_ip:2222" $(for ip in ${first_engine_ips//,/ }; do printf '%s:8642 %s:9119 ' "$ip" "$ip"; done) $(for ip in ${first_exit_ips//,/ }; do printf '%s:3128 ' "$ip"; done); do
  printf '{"host":"%s","port":%s},' "${item%:*}" "${item##*:}"; done | sed 's/,$//')
other_refused=$(for host in "$first_sandbox_ip" ${first_engine_ips//,/ } ${first_exit_ips//,/ }; do printf '"%s",' "$host"; done | sed 's/,$//')
other_unreached=$(for item in gtmworks-sandbox-first:2222 gtmworks-engine-first:8642 gtmworks-engine-first:9119 gtmworks-exit-first:3128; do
  printf '{"host":"%s","port":%s},' "${item%:*}" "${item##*:}"; done | sed 's/,$//')
sandbox_exit_probe "$second_container" "$(printf '{"direct":[%s],"refused":[%s],"unreached":[%s]}' "$other_direct" "$other_refused" "$other_unreached" | base64 -w0)" \
  || fail "the second Company's sandbox reaches nothing of the first Company's, directly or through its exit"
# One Engine's key is refused by the other Engine, in both directions.
key_status() { compose exec -T -e CHECK_KEY="$1" -e CHECK_URL="$2" web node --input-type=module -e "const r=await fetch(process.env.CHECK_URL,{headers:{Authorization:'Bearer '+process.env.CHECK_KEY}}); console.log(r.status); if(![401,403].includes(r.status)) process.exitCode=1;"; }
key_status "$engine_key" "http://$second_container:9119/api/profiles" || fail "the second Engine refuses the first Engine's key"
key_status "$second_key" "$engine_management/api/profiles" || fail "the first Engine refuses the second Engine's key"
# Every Company's work sandbox (#393, ADR 0018), as the installer started it: the image the install recorded, an ordinary
# user, no capability, no new privilege, its process limit and shared memory, the install's default RAM and CPU, no host
# port and no Docker socket. The static test pins the template; this reads the containers an install really runs.
sandbox_image=$(cat .work-sandbox-image)
for folder in .engines/*/; do
  [ -f "$folder/.env" ] || continue
  name=$(engine_value "$folder" NAME)
  slug=${name#gtmworks-engine-}
  sandbox=$(docker ps -q --filter "name=^gtmworks-sandbox-$slug$") || fail "the sandbox of $slug"
  [[ -n $sandbox ]] || fail "the sandbox of $slug runs"
  [[ $(docker inspect -f '{{.Config.Image}}' "$sandbox") == "$sandbox_image" ]] || fail "the sandbox of $slug runs the image the install recorded"
  [[ $(docker inspect -f '{{.Config.User}}' "$sandbox") == '' || $(docker inspect -f '{{.Config.User}}' "$sandbox") == pn ]] || fail "the sandbox of $slug runs as the image's own user"
  [[ $(docker exec "$sandbox" id -u) == 1000 ]] || fail "the sandbox of $slug runs as an ordinary user, never root"
  [[ $(docker inspect -f '{{join .HostConfig.CapDrop ","}}' "$sandbox") == ALL ]] || fail "the sandbox of $slug drops every capability"
  [[ -z $(docker inspect -f '{{join .HostConfig.CapAdd ","}}' "$sandbox") ]] || fail "the sandbox of $slug adds no capability"
  [[ $(docker inspect -f '{{join .HostConfig.SecurityOpt ","}}' "$sandbox") == *no-new-privileges* ]] || fail "the sandbox of $slug has no new privileges"
  [[ $(docker inspect -f '{{.HostConfig.PidsLimit}}' "$sandbox") == 2048 ]] || fail "the sandbox of $slug has its process limit"
  [[ $(docker inspect -f '{{.HostConfig.ShmSize}}' "$sandbox") == 1073741824 ]] || fail "the sandbox of $slug has shared memory for Chromium"
  # The first Company was given no limit, so its sandbox has the install's default; the second has the ones its add named.
  if [[ $slug == first ]]; then want_memory=$(sandbox_memory_bytes) want_cpus=$(sandbox_nano_cpus); else want_memory=1610612736 want_cpus=1500000000; fi
  [[ $(docker inspect -f '{{.HostConfig.Memory}}' "$sandbox") == "$want_memory" ]] || fail "the sandbox of $slug has the memory its Company was given, or the install's default"
  [[ $(docker inspect -f '{{.HostConfig.NanoCpus}}' "$sandbox") == "$want_cpus" ]] || fail "the sandbox of $slug has the CPUs its Company was given, or the install's default"
  ! publishes_host_port "$sandbox" || fail "the sandbox of $slug publishes no host port"
  if docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$sandbox" | grep -q 'docker.sock'; then fail "the sandbox of $slug mounts no Docker socket"; fi
  # Each Company's exit (#394), from the same template: the same image, healthy, an ordinary user with no capability,
  # no new privilege, no mount and no port, on its Company's work network and its own outbound network only.
  exit_id=$(docker ps -q --filter "name=^gtmworks-exit-$slug$") || fail "the exit of $slug"
  [[ -n $exit_id ]] || fail "the exit of $slug runs"
  [[ $(docker inspect -f '{{.Config.Image}}' "$exit_id") == "$sandbox_image" ]] || fail "the exit of $slug runs the work sandbox image"
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$exit_id") == healthy ]] || fail "the exit of $slug is healthy"
  [[ $(docker exec "$exit_id" id -u) == 1000 ]] || fail "the exit of $slug runs as an ordinary user"
  [[ $(docker inspect -f '{{join .HostConfig.CapDrop ","}}' "$exit_id") == ALL && $(docker inspect -f '{{join .HostConfig.SecurityOpt ","}}' "$exit_id") == *no-new-privileges* ]] \
    || fail "the exit of $slug drops every capability and has no new privileges"
  [[ -z $(docker inspect -f '{{range .Mounts}}{{println .Type .Name}}{{end}}' "$exit_id" | grep . | grep -Ev '^volume [0-9a-f]{64}$') ]] && ! publishes_host_port "$exit_id" \
    || fail "the exit of $slug mounts no folder and no volume of the install, and publishes no port"
  [[ $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$exit_id" | grep . | sort) == $(printf '%s\n' "gtmworks-exit-$slug" "gtmworks-work-$slug" | sort) ]] \
    || fail "the exit of $slug joins its work network and its own outbound network only"
done
# The sandbox takes its own Engine's key and no password (#393): the private half is only among that Engine's files, in
# its data volume, and the sandbox holds no private key at all.
second_volume=$(engine_value "$second_folder" VOLUME)
public_of() { docker run --rm --user 0 --entrypoint sh -v "$1:/data:ro" "$sandbox_image" -ec 'ssh-keygen -y -f /data/ssh/id_ed25519'; }
first_public=$(public_of "$(engine_value .engines/first VOLUME)") || fail "the first Engine's sandbox key"
second_public=$(public_of "$second_volume") || fail "the second Engine's sandbox key"
[[ -n $first_public && -n $second_public && $first_public != "$second_public" ]] || fail 'each Engine has a key pair of its own'
docker exec "$engine_id" test -f /opt/data/ssh/id_ed25519 || fail "the first Engine holds its sandbox key"
[[ $(docker exec "$engine_id" stat -c %u /opt/data/ssh/id_ed25519) == 10000 ]] || fail "the sandbox key belongs to the Engine's own user"
[[ $(docker exec "$engine_id" stat -c %a /opt/data/ssh/id_ed25519) == 600 ]] || fail "the sandbox key is owner-only"
if docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')" | grep -q 'PRIVATE KEY'; then fail 'the sandbox holds no private key in its environment'; fi
docker exec "$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')" sh -ec 'test -s /home/pn/.ssh/authorized_keys && grep -q "^ssh-ed25519 " /home/pn/.ssh/authorized_keys' || fail "the sandbox takes its Engine's public key"
if docker exec "$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')" sh -ec 'grep -rl "PRIVATE KEY" /home/pn /work /tmp 2> /dev/null | grep -v "^/home/pn/.ssh-host/" | grep .'; then fail 'the sandbox holds no private key of any Engine'; fi
# The sandbox's own address on its work network: the Engine dials the alias `sandbox`, which the Agent's Run proves; a
# throwaway container asks the same Docker DNS for it, and a momentary failure there must not read as a refused key.
first_sandbox=$(docker ps -q --filter "name=^gtmworks-sandbox-first$")
sandbox_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$first_sandbox")
docker exec "$engine_id" cat /opt/data/ssh/id_ed25519 | docker run --rm -i -e SANDBOX_IP="$sandbox_ip" --network gtmworks-work-first --entrypoint sh "$sandbox_image" -ec '
  set -e
  cat > /tmp/key; chmod 600 /tmp/key
  ssh-keygen -q -t ed25519 -N "" -f /tmp/wrong
  options="-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
  test "$(ssh -i /tmp/key $options -p 2222 pn@$SANDBOX_IP id -un)" = pn
  if ssh -i /tmp/wrong $options -p 2222 pn@$SANDBOX_IP true 2> /tmp/wrong.err; then echo "a wrong key was accepted" >&2; exit 1; fi
  grep -q "Permission denied (publickey)" /tmp/wrong.err
  if ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no $options -p 2222 pn@$SANDBOX_IP true 2> /tmp/password.err; then echo "a password was accepted" >&2; exit 1; fi
  grep -q "Permission denied (publickey)" /tmp/password.err
' || fail "the sandbox accepts its Engine's key and no password"
# The second Company's Agent works in the second Company's sandbox (#396): its command runs there, in its own folder,
# and the file it writes is in that Company's work folder alone. The first Company's sandbox, and the first Engine's
# read-only copy of its work folder that its Library lists, hold no trace of it. The host's Docker says where it landed.
company_marker="company-sandbox-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
engine_node "$engine_key" - company-sandbox "$company_marker" 'Second Company' < scripts/check-install-profiles.mjs | tee company-sandbox.log \
  || fail "the second Company's Agent runs a command"
company_host=$(sed -n 's/.*"sandbox_host":"\([^"]*\)".*/\1/p' company-sandbox.log | tail -n 1)
company_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' company-sandbox.log | tail -n 1)
[[ -n $company_host && $company_host == "$(docker exec "$second_sandbox" hostname)" ]] || fail "the second Company's Agent's command runs in the second Company's sandbox"
[[ $(docker exec "$second_sandbox" cat "$company_cwd/$company_marker.txt") == "$company_marker" ]] || fail "the second Company's Agent's file is in its own work folder"
[[ -z $(docker exec "$first_sandbox" sh -c 'find /work -name "$1*"; grep -rl -- "$1" /work 2> /dev/null; true' sh "$company_marker") ]] \
  || fail "the second Company's Agent's file never appears in the first Company's sandbox"
[[ -z $(docker exec "$engine_id" sh -c 'find /opt/data/work -name "$1*"; grep -rl -- "$1" /opt/data/work 2> /dev/null; true' sh "$company_marker") ]] \
  || fail "the second Company's Agent's file never appears in the first Company's Library"
# And the other way round from the second Company's check above: from the first Company's sandbox, the second Company's
# sandbox, Engine and exit are reached neither directly nor through the first Company's exit.
second_engine_ips=$(addresses_of "$second_container")
second_sandbox_ip=$(addresses_of "$second_sandbox")
second_exit_ips=$(addresses_of "$second_exit")
other_direct=$(for item in "$second_sandbox:2222" "$second_container:8642" "$second_container:9119" "$second_exit:3128" "$second_sandbox_ip:2222" \
  $(for ip in ${second_engine_ips//,/ }; do printf '%s:8642 %s:9119 ' "$ip" "$ip"; done) $(for ip in ${second_exit_ips//,/ }; do printf '%s:3128 ' "$ip"; done); do
  printf '{"host":"%s","port":%s},' "${item%:*}" "${item##*:}"; done | sed 's/,$//')
other_refused=$(for host in "$second_sandbox_ip" ${second_engine_ips//,/ } ${second_exit_ips//,/ }; do printf '"%s",' "$host"; done | sed 's/,$//')
other_unreached=$(for item in "$second_sandbox:2222" "$second_container:8642" "$second_container:9119" "$second_exit:3128"; do
  printf '{"host":"%s","port":%s},' "${item%:*}" "${item##*:}"; done | sed 's/,$//')
sandbox_exit_probe "$engine_id" "$(printf '{"direct":[%s],"refused":[%s],"unreached":[%s]}' "$other_direct" "$other_refused" "$other_unreached" | base64 -w0)" \
  || fail "the first Company's sandbox reaches nothing of the second Company's, directly or through its exit"
# `gtmworks company list` and `gtmworks status` report each Company's own Engine and its state, and its sandbox (#396).
sh scripts/install.sh company list | tee company-list.log || fail 'company list'
grep -F '"Proxy Company": Engine http://gtmworks-engine-first:8642 (healthy)' company-list.log || fail 'company list names the first Company and its healthy Engine'
grep -F "\"Second Company\": Engine $second_address (healthy)" company-list.log || fail 'company list names the second Company and its healthy Engine'
grep -F 'Sandbox gtmworks-sandbox-first: running (Company "Proxy Company")' company-list.log || fail 'company list names the first sandbox and its state'
grep -F "Sandbox $second_sandbox: running (Company \"Second Company\")" company-list.log || fail 'company list names the second sandbox and its state'
sh scripts/install.sh engines | tee engines.log || fail 'every Engine is reported'
grep -F "Engine $second_address: healthy (Company \"Second Company\")" engines.log || fail 'the Engine report names the second Engine'
# `gtmworks status` reports each Company's work sandbox beside its Engine, and fails when one is not running (#393).
grep -F 'Sandbox gtmworks-sandbox-first: running (Company "Proxy Company")' engines.log || fail 'the report names the first sandbox and its Company'
grep -F "Sandbox $second_sandbox: running (Company \"Second Company\")" engines.log || fail 'the report names the second sandbox and its Company'
docker stop "$second_sandbox" > /dev/null || fail 'stop the second sandbox'
if sh scripts/install.sh engines > engines-sandbox-stopped.log 2>&1; then
  cat engines-sandbox-stopped.log
  fail 'a stopped sandbox must fail the report'
fi
grep -F "Sandbox $second_sandbox: stopped (Company \"Second Company\")" engines-sandbox-stopped.log || fail 'the report says the sandbox is stopped'
sh scripts/install.sh company list > company-list-stopped.log 2>&1 || true
grep -F "Sandbox $second_sandbox: stopped (Company \"Second Company\")" company-list-stopped.log || { cat company-list-stopped.log; fail 'company list says the sandbox is stopped'; }
docker start "$second_sandbox" > /dev/null || fail 'start the second sandbox'
for attempt in $(seq 1 60); do
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$second_sandbox") == healthy ]] && break
  sleep 1
done
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$second_sandbox") == healthy ]] || fail 'the second sandbox is healthy again'
# A Company with no Owner yet is held behind a first-Owner link (#383, ADR 0019): the command prints the link,
# only its hash is stored, the Company exists nowhere, `company list` shows it waiting for its Owner, and a
# fresh link ends the earlier one. Sending the fresh link's form then makes the Company with its sender as
# Owner, signed in, on that link's own Engine record.
sh scripts/install.sh company add --name 'Linked Company' > company-link.log 2>&1 || fail 'company add with no Owner holds a Company behind its first-Owner link'
cat company-link.log
first_link=$(grep -o 'http://[^[:space:]]*/first-owner#code=[a-f0-9]*' company-link.log | head -n 1)
[[ -n $first_link ]] || fail 'company add prints the first-Owner link'
first_hash=$(printf '%s' "${first_link#*#code=}" | sha256sum | cut -d' ' -f1)
[[ $(db -c "select count(*) from public.company_owner_links where company_name='Linked Company' and secret_hash='$first_hash' and claimed_at is null") == 1 ]] || fail 'only the link secret is kept, hashed, and the link waits'
[[ $(db -c "select count(*) from public.company_owner_links where secret_hash='${first_link#*#code=}'") == 0 ]] || fail 'the link secret itself is stored nowhere'
[[ $(db -c "select count(*) from public.companies where name='Linked Company'") == 0 ]] || fail 'the Company exists nowhere until its link is used'
sh scripts/install.sh company list | tee company-waiting.log || fail 'company list with a Company waiting for its Owner'
grep -F "Company \"Linked Company\": waiting for its Owner (Engine http://gtmworks-engine-linked-company" company-waiting.log || fail 'company list shows the Company waiting for its Owner'
sh scripts/install.sh company link 'Linked Company' > company-link-fresh.log 2>&1 || fail 'company link prints a fresh link'
cat company-link-fresh.log
second_link=$(grep -o 'http://[^[:space:]]*/first-owner#code=[a-f0-9]*' company-link-fresh.log | head -n 1)
second_hash=$(printf '%s' "${second_link#*#code=}" | sha256sum | cut -d' ' -f1)
[[ -n $second_link && $second_link != "$first_link" ]] || fail 'a fresh link for the waiting Company is a new link'
[[ $(db -c "select count(*) from public.company_owner_links where secret_hash='$first_hash'") == 0 ]] || fail 'a fresh link ends the earlier one'
[[ $(db -c "select count(*) from public.company_owner_links where secret_hash='$second_hash' and claimed_at is null") == 1 ]] || fail 'the fresh link is the one waiting'
compose exec -T -e LINK_SECRET="${second_link#*#code=}" web node --input-type=module - < scripts/check-install-owner-link.mjs > owner-link-proof \
  || fail 'sending the first-Owner link makes the Company and signs its Owner in'
cat owner-link-proof
[[ $(db -c "select count(*) from public.companies c join public.company_engines e on e.id=c.engine_id where c.name='Linked Company' and e.address like 'http://gtmworks-engine-linked-company%'") == 1 ]] || fail 'the link makes the Company on its own Engine record'
[[ $(db -c "select m.role from public.members m join public.companies c on c.id=m.company_id join auth.users u on u.id=m.person_id where c.name='Linked Company' and u.email='linked-owner@example.test'") == owner ]] || fail "the link's sender is the Company Owner"
[[ $(db -c "select count(*) from public.company_owner_links where secret_hash='$second_hash' and claimed_at is not null") == 1 ]] || fail 'the link is used once'
sh scripts/install.sh company list | tee company-claimed.log || fail 'company list after the link is used'
grep -F "Company \"Linked Company\": Engine http://gtmworks-engine-linked-company" company-claimed.log || fail 'the Company the link made is listed with its Engine'
[[ -n $(docker ps -q --filter 'name=^gtmworks-sandbox-linked-company-') ]] || fail 'the Company the link made runs its own sandbox'
# Stopping the second Company's Engine leaves the first Company answering, then the second Engine starts again.
docker stop "$second_container" > /dev/null || fail 'stop the second Engine'
engine_node "$engine_key" - < scripts/check-install-conversation.mjs || fail 'the first Company still answers while the second Engine is stopped'
# A Company whose work sandbox is not running (#398): one read of its Engine's own ssh workspace names the state; a
# message that needs a command gets its reply with the failed sandbox step under it; a message that needs no tool is
# answered as usual. Started again, the next command runs in it with no restart of the install. The job reads the marker
# from the sandbox's disk, so a tool's own answer cannot fake it. This area, not agents, takes the check: agents is near
# its time budget (docs/agents/checks.md).
sandbox_marker="sandbox-down-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
docker stop gtmworks-sandbox-first > /dev/null || fail 'stop the first Company sandbox'
engine_node "$engine_key" - sandbox-down "$sandbox_marker" < scripts/check-install-sandbox-down.mjs | tee sandbox-down-proof.log \
  || fail 'a Company whose work sandbox is not running says so, and its Conversation still answers'
grep -q '"sandbox":"notRunning"' sandbox-down-proof.log || fail 'the Company reads its work sandbox as not running'
grep -q '"plain":"answered"' sandbox-down-proof.log || fail 'a message that needs no tool is answered while the work sandbox is not running'
docker start gtmworks-sandbox-first > /dev/null || fail 'start the first Company sandbox'
engine_healthy gtmworks-sandbox-first 60 || fail 'the first Company sandbox is healthy again'
engine_node "$engine_key" - sandbox-up "$sandbox_marker" < scripts/check-install-sandbox-down.mjs | tee sandbox-up-proof.log \
  || fail 'the next command runs once the work sandbox is running again, with no restart'
grep -q '"sandbox":"running"' sandbox-up-proof.log || fail 'the Company reads its work sandbox as running again'
[[ $(docker exec gtmworks-sandbox-first cat "/work/$sandbox_marker-sandbox-up.txt") == "$sandbox_marker-sandbox-up" ]] \
  || fail 'the next command runs in the work sandbox once it is running again'
docker start "$second_container" > /dev/null || fail 'start the second Engine'
engine_healthy "$second_container" 120 || fail 'the second Engine is healthy again'
# `gtmworks company limits` (#396) changes one Company's limits: its sandbox alone is made again with them, its Engine
# and the first Company's sandbox run on untouched meanwhile, and its work folder is kept.
limits_of() { docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$1"; }
started_of() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$1"; }
docker exec "$second_sandbox" sh -ec 'printf kept > /work/limits-kept.txt' || fail 'write a file in the second work folder'
[[ $(limits_of "$second_sandbox") == '1610612736 1500000000' ]] || fail 'the second sandbox has the limits its add named'
first_before=$(started_of gtmworks-sandbox-first) second_engine_before=$(started_of "$second_container") second_before=$(started_of "$second_sandbox")
second_exit_before=$(started_of "$second_exit")
sh scripts/install.sh company limits 'Second Company' --memory 768m --cpus 1 | tee company-limits.log || fail 'company limits changes the second Company'
grep -Fx 'Company "Second Company": its work sandbox now has 768 MiB of memory and 1 CPUs.' company-limits.log || fail 'company limits says the limits the sandbox has'
[[ $(limits_of "$second_sandbox") == '805306368 1000000000' ]] || fail 'the second sandbox runs with its new limits'
[[ $(started_of "$second_sandbox") != "$second_before" ]] || fail 'the second sandbox was started again with its new limits'
[[ $(started_of gtmworks-sandbox-first) == "$first_before" ]] || fail "the first Company's sandbox kept running while the second's limits changed"
[[ $(started_of "$second_container") == "$second_engine_before" && $(started_of "$second_exit") == "$second_exit_before" ]] || fail "only the second Company's sandbox was started again"
[[ $(docker exec "$second_sandbox" cat /work/limits-kept.txt) == kept ]] || fail 'the work folder is kept when the limits change'
[[ $(limits_of gtmworks-sandbox-first) == "$(sandbox_memory_bytes) $(sandbox_nano_cpus)" ]] || fail "the first Company's sandbox keeps the install's default"
# The first Company too, by its one limit; then a repeat install with other values left in the shell: every sandbox keeps
# the limits its Company was given, which are kept with the Company's own files (the review's finding on #400).
sh scripts/install.sh company limits 'Proxy Company' --cpus 1.5 || fail 'company limits changes the first Company'
[[ $(limits_of gtmworks-sandbox-first) == "$(sandbox_memory_bytes) 1500000000" ]] || fail "the first Company's sandbox runs with its new CPU limit and the default memory"
SANDBOX_MEMORY=3g SANDBOX_CPUS=3 sh scripts/install.sh > companies-repeat.log 2>&1 || { cat companies-repeat.log; fail 'a repeat install with limits in the shell'; }
[[ $(limits_of gtmworks-sandbox-first) == "$(sandbox_memory_bytes) 1500000000" ]] || fail "a repeat install keeps the first Company's limits"
[[ $(limits_of "$second_sandbox") == '805306368 1000000000' ]] || fail "a repeat install keeps the second Company's limits"
# #711: the second Company's limit as a release before the Screens wrote it (no default noted beside it) is raised to the
# default by the next run, once; a Company's limit above the default is never lowered.
second_file="$(dirname "$(grep -lx "ENGINE_NAME=$second_container" .engines/*/.env)")/.env"
grep -v '^SANDBOX_MEMORY_DEFAULT=' "$second_file" > "$second_file.old" && mv "$second_file.old" "$second_file" || fail 'the second Company file as the previous release wrote it'
sh scripts/install.sh company limits 'Proxy Company' --memory 3g || fail 'the first Company above the default'
sh scripts/install.sh > companies-raise.log 2>&1 || { cat companies-raise.log; fail 'the run that raises a lower limit'; }
grep -F "had 768m of memory: raised to $(sandbox_default mem_limit)" companies-raise.log || fail 'the run says it raised the lower limit'
[[ $(limits_of "$second_sandbox") == "$(sandbox_memory_bytes) 1000000000" ]] || fail "the second Company's lower memory limit is raised to the default"
[[ $(limits_of gtmworks-sandbox-first) == '3221225472 1500000000' ]] || fail "the first Company's limit above the default is kept"
}

# The Engine holds none of gtmworks's own keys and passwords (#2): its environment and every file its user can
# read are scanned for the real values in .env.install, passed on stdin; only names and paths are printed. Every
# Engine of the install is scanned, the first and each Company's own (#382). The agents and agents-sandbox areas each end
# with it (#553).
scan_engines() {
engines_scanned=0
for folder in .engines/*/; do
  [ -f "$folder/.env" ] || continue
  name=$(engine_value "$folder" NAME)
  [[ -n $(docker ps -q --filter "name=^${name}$") ]] || fail "the Engine container $name"
  engines_scanned=$((engines_scanned+1))
  { grep -E '^(POSTGRES_PASSWORD|PGSODIUM_ROOT_KEY|SUPABASE_JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|WEBHOOK_ENCRYPTION_KEY|SETUP_CODE)=' .env.install | docker exec -i -u hermes "$name" /opt/hermes/.venv/bin/python -c "$(cat scripts/check-hermes-keys.py)"; } || fail "the Engine $name holds none of gtmworks's keys and passwords"
  # The sandbox runs the Agents' code, so it is scanned too, with its own Engine's keys added (#393, #394): its API key,
  # a line of the private key it dials the sandbox with (the line that holds its secret half, past the header every
  # OpenSSH key shares), and the model credential the Engine was given. Its exit is scanned the same way: nothing the
  # sandbox can reach holds a key.
  engine_ssh_line=$(docker exec -u 0 "$name" sed -n 5p /opt/data/ssh/id_ed25519) || fail "read the private key of $name"
  [[ ${#engine_ssh_line} -ge 40 ]] || fail "a line of the private key of $name"
  for scanned in "$(sandbox_of "$name")" "$(exit_of "$name")"; do
    { { grep -E '^(POSTGRES_PASSWORD|PGSODIUM_ROOT_KEY|SUPABASE_JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|WEBHOOK_ENCRYPTION_KEY|SETUP_CODE)=' .env.install
        printf 'ENGINE_KEY=%s\nENGINE_SSH_KEY=%s\nMODEL_KEY=fake-model-key\n' "$(engine_value "$folder" KEY)" "$engine_ssh_line"; } \
      | docker exec -i -u pn "$scanned" python3 -c "$(cat scripts/check-hermes-keys.py)"; } \
      || fail "$scanned holds none of gtmworks's keys, not its Engine's key, not its Engine's private key and no model credential"
  done
done
[[ $engines_scanned -ge 2 ]] || fail 'the scan covers every Engine'
}

# agents: Agents on their Engines (#378, #408): an Agent made and run through the contract, the Engine management listener
# never public, the profile of each Company with the terminal, files and code execution on, its memory and lessons kept
# to its own Company, the apps, and the scan that neither the Engine nor the sandbox holds a key of gtmworks. The area
# makes the install it starts from, its first run and its second Company itself, so first-install no longer runs it
# (#408). What an Agent runs in its Company's work sandbox is the agents-sandbox area's, on a machine of its own (#553).
agents() {
cd "$root"
area_setup
reset_install
install_source agents-install.log || fail 'first install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
engine_id=$(first_engine_id) || fail 'the Engine container'
engine_key=$(first_engine_key)
# The Engine answers a Run with no subscription through the fake model provider served from the web container (#378).
point_engine_at_fake_model "$engine_id"
# The second Company on its own Engine, for the profile and memory checks that need two (#382).
second_company || fail 'company add makes the second Company'
# The Engine's management listener (ADR 0011): an Agent made through the contract runs, the worker reaches it with
# the Engine's key, and it is never public: the gateway routes only to the app, and no host port is published.
engine_node "$engine_key" - < scripts/check-install-agent.mjs || fail 'Agent created in the Engine and a Run started for it'
ENGINE_KEY="$engine_key" compose exec -T -e ENGINE_KEY worker node -e "fetch('$engine_management/api/profiles',{headers:{Authorization:'Bearer '+process.env.ENGINE_KEY}}).then(response=>process.exit(response.status===200?0:1)).catch(()=>process.exit(1))" || fail 'worker reaches the Engine management listener with its key'
body=$(docker run --rm --network host curlimages/curl:8.12.1 -sS http://127.0.0.1:3000/api/profiles) || fail 'management path request on install host port 3000'
status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/profiles) || fail 'management path status on install host port 3000'
[[ $status == 404 && $body != *is_default* ]] || fail "public gateway must not reach the management listener (HTTP $status)"
if docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null --max-time 5 http://127.0.0.1:9119/api/profiles; then fail 'management listener must not be published on the host'; fi
# One Engine per Company (ADR 0018): the first Company's Engine and the second Company's own Engine each hold
# their Company's profiles, with terminal, files and code execution off in the profile's config and absent from
# its Runs' toolsets, with the terminal, files and code execution on and run in the Company's work sandbox.
# A run on each answers across the two Engines, and a memory written in the first Engine reaches its run and never an
# Agent of the other Company. A lesson its Owner approves reaches the runs of the
# first Company's Agents only, which cannot change it (#122).
engine_node "$engine_key" - prepare < scripts/check-install-profiles.mjs | tee prepare-profiles.log || fail 'two companies get two profiles on two Engines with the work tools on, each with one shared space'
first=$(tail -n 1 prepare-profiles.log)
[[ $first =~ ^co-[0-9a-f]{32}$ ]] || fail "the first company's profile name"
# One Company cannot name another's profile (#126): the database refuses the row, whoever writes it.
company_b=$(db -c "select id from public.companies where name='Second Company'") || fail 'the second profile company'
if db -c "insert into public.hermes_agents(company_id,profile,name,speciality) values ('$company_b','$first','Other company agent','Writes the install check.')" 2> profile-refusal.log; then fail 'the database refuses a profile of another company'; fi
grep -q hermesProfileNotShared profile-refusal.log || { cat profile-refusal.log >&2; fail 'the database refuses a profile of another company, by its guard'; }
marker="memory-check-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
docker exec -i "$engine_id" sh -ec 'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' sh "$first" "$marker" || fail "write a memory in the first company's profile"
engine_node "$engine_key" - verify "$marker" < scripts/check-install-profiles.mjs || fail "runs on each company profile answer, and a company's memory and approved lessons stay in its own runs"
# Apps (#30, #458), on the first company's profile with no vendor sign-in: every entry of the pinned Engine's catalogue is
# offered; connecting a catalogue app writes no tool filter and comes back through gtmworks; and the Owner's own server is
# added, tested, turned on for one Agent and removed through the same driver, for no sign-in, a token and OAuth, against a
# fake MCP server the check starts inside this container (the Engine reaches it as http://web:9123).
engine_node "$engine_key" - < scripts/check-install-apps.mjs || fail 'apps come with all their tools, and any remote MCP server is added and removed'
scan_engines
}

# agents-sandbox: an Agent's work in its Company's work sandbox (#393, #395, #459, ADR 0018, ADR 0024), split from the
# agents area to keep each within its minutes (#553): its command, file and code run in the sandbox and never on its
# Engine, a command MCP server runs there, its Library shows the work folder, the Engine pins the sandbox's host key, no
# file sync runs between them, the Company's Screen opens a page for an Agent's Run and sleeps and wakes (#711), the apps
# still answer, and the same scan of every Engine, sandbox and exit. It makes its
# own install, first run and second Company, and the first Company's second Agent the sandbox checks start in.
agents_sandbox() {
cd "$root"
area_setup
reset_install
install_source agents-sandbox-install.log || fail 'first install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
engine_id=$(first_engine_id) || fail 'the Engine container'
engine_key=$(first_engine_key)
point_engine_at_fake_model "$engine_id"
second_company || fail 'company add makes the second Company'
engine_node "$engine_key" - prepare < scripts/check-install-profiles.mjs | tee prepare-profiles.log || fail 'two companies get two profiles on two Engines with the work tools on, each with one shared space'
first=$(tail -n 1 prepare-profiles.log)
[[ $first =~ ^co-[0-9a-f]{32}$ ]] || fail "the first company's profile name"
engine_node "$engine_key" - second < scripts/check-install-profiles.mjs || fail "the first Company's second Agent moves to a profile of its own"
# The work sandbox (#393, ADR 0018): the command, file and code an Agent asks for run in the Company's sandbox and never
# on its Engine, two Agents start in a folder of their own inside the Company's work folder, and a profile write and a
# settings write cannot move a command off the sandbox. The job reads the host's Docker for where each marker landed: a
# tool's own answer cannot fake that.
sandbox_marker="sandbox-check-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
engine_node "$engine_key" - sandbox "$sandbox_marker" < scripts/check-install-profiles.mjs | tee sandbox-proof.log \
  || fail 'an Agent runs its command, file and code in the work sandbox'
sandbox=gtmworks-sandbox-first
sandbox_host=$(sed -n 's/.*"sandbox_host":"\([^"]*\)".*/\1/p' sandbox-proof.log | tail -n 1)
[[ -n $sandbox_host && $sandbox_host == "$(docker exec "$sandbox" hostname)" ]] || fail "an Agent's command runs in the work sandbox"
grep -q "\"cwd\":\"/work/$first\"" sandbox-proof.log || fail "an Agent's command starts in its own folder in the work folder"
second_pwd=$(sed -n 's/.*"pwd":"\/work\/\([^"]*\)".*/\1/p' sandbox-proof.log | tail -n 1)
[[ -n $second_pwd && $second_pwd == ag-* && $second_pwd != "$first" ]] || fail "a second Agent's command starts in a folder of its own in the work folder"
[[ $(docker exec "$sandbox" cat "/work/$sandbox_marker-terminal.txt") == "$sandbox_marker-terminal" ]] || fail "the Agent's command wrote in the Company's work folder"
[[ $(docker exec "$sandbox" cat "/work/$sandbox_marker-file.txt") == "$sandbox_marker-file" ]] || fail "the file an Agent wrote is in the Company's work folder"
[[ $(docker exec "$sandbox" cat "/work/$sandbox_marker-code.txt") == "$sandbox_marker-code" ]] || fail "the code an Agent ran wrote in the work sandbox"
if docker exec "$engine_id" sh -ec "test -e /work/$sandbox_marker-terminal.txt -o -e /work/$sandbox_marker-file.txt -o -e /work/$sandbox_marker-code.txt"; then
  fail 'nothing an Agent wrote is on the Engine'
fi
# A command MCP server runs in the work sandbox (#459, ADR 0024): a small stdio server placed in the Company's work folder
# is added as the Owner's own command server and Test lists its tool. The Engine is then restarted, which connects every
# configured server at its start (its MCP reconcile tick otherwise took from 23 s to over 4 min here), and an Agent calls
# the tool from a Conversation. While the call holds, the host's Docker lists both containers' processes: the server is a
# process of the sandbox, and the Engine holds only the ssh client that reaches it. Then the job releases the call and
# reads where it wrote.
mcp_marker="sandbox-mcp-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
docker exec -i "$sandbox" sh -ec 'mkdir -p /work/tools; cat > /work/tools/sandbox-proof-mcp.mjs' < scripts/sandbox-proof-mcp.mjs \
  || fail 'place the small MCP server in the work sandbox'
engine_node "$engine_key" - sandbox-mcp-add "$mcp_marker" < scripts/check-install-profiles.mjs \
  || fail 'a command server the Owner adds is ssh into the work sandbox, and Test lists its tool'
docker restart "$engine_id" > /dev/null || fail 'restart the Engine'
engine_healthy "$engine_id" 60 || fail 'the Engine is healthy after its restart'
engine_node "$engine_key" - sandbox-mcp "$mcp_marker" < scripts/check-install-profiles.mjs > sandbox-mcp-proof.log 2>&1 &
mcp_check=$!
mcp_calling=''
for attempt in $(seq 1 420); do
  docker exec "$sandbox" test -f "/work/$first/$mcp_marker-calling.txt" 2> /dev/null && { mcp_calling=yes; break; }
  kill -0 "$mcp_check" 2> /dev/null || break
  sleep 1
done
if [[ $mcp_calling != yes ]]; then
  cat sandbox-mcp-proof.log >&2
  docker exec "$engine_id" sh -c 'grep -h "sandbox-proof\|reconciled\|MCP server" /opt/data/logs/*.log /opt/data/profiles/*/logs/*.log 2> /dev/null | tail -n 20' >&2 || true
  fail 'an Agent calls the tool of a command server in the work sandbox'
fi
# Each container's process list is read whole first: under pipefail a `| grep -q` that stops reading early can fail the
# pipe on a match. Each check prints the list it read when it fails. Node names its main thread, so the server's command
# name reads `node-MainThread` once it runs.
sandbox_ps=$(docker exec "$sandbox" ps -eo comm=,args=) || fail 'list the work sandbox processes'
engine_ps=$(docker exec "$engine_id" ps -eo comm=,args=) || fail 'list the Engine processes'
awk '$1 ~ /^node/ && /sandbox-proof-mcp[.]mjs/ {found=1} END {exit !found}' <<< "$sandbox_ps" \
  || { printf '%s\n' "$sandbox_ps" >&2; fail 'the command server is a process of the work sandbox during the call'; }
if awk '$1 != "ssh" && /sandbox-proof-mcp[.]mjs/ {found=1} END {exit !found}' <<< "$engine_ps"; then
  printf '%s\n' "$engine_ps" >&2; fail 'no process of the Engine runs the command server'
fi
awk '$1 == "ssh" && /pn@sandbox/ && /sandbox-proof-mcp[.]mjs/ {found=1} END {exit !found}' <<< "$engine_ps" \
  || { printf '%s\n' "$engine_ps" >&2; fail 'the Engine reaches the command server over ssh into the sandbox'; }
docker exec "$sandbox" touch "/work/$first/$mcp_marker.release" || fail 'release the call'
wait "$mcp_check" || { cat sandbox-mcp-proof.log >&2; fail 'a command server the Owner adds runs in the work sandbox and an Agent calls its tool'; }
cat sandbox-mcp-proof.log
mcp_host=$(sed -n 's/.*"sandbox_host":"\([^"]*\)".*/\1/p' sandbox-mcp-proof.log | tail -n 1)
[[ -n $mcp_host && $mcp_host == "$(docker exec "$sandbox" hostname)" ]] || fail 'the command server ran in the work sandbox'
docker exec "$sandbox" grep -q "^$mcp_host /work/$first " "/work/$first/$mcp_marker-mcp.txt" \
  || fail "the command server wrote in the Agent's own folder of the Company's work folder"
if docker exec "$engine_id" test -e "/work/$first/$mcp_marker-mcp.txt"; then fail 'nothing the command server wrote is on the Engine'; fi
# The Library shows the Company's work folder (#395): an Agent's file and picture in its own folder are listed, previewed
# and downloaded with the same bytes through gtmworks; the Engine reads that folder and cannot write to it, as root or as
# its own user, and nothing it tried reaches the sandbox.
library_marker="library-check-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
# The second Agent's memory on the Engine's disk, which a link the first Agent plants in its folder points at: the
# Library must never read it (#395).
docker exec -i "$engine_id" sh -ec 'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The leak word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' sh "$second_pwd" "$library_marker-leak" \
  || fail "write a memory in the second Agent's profile"
engine_node "$engine_key" - library "$library_marker" < scripts/check-install-profiles.mjs | tee library-proof.log \
  || fail "an Agent's file is in its Library, previews and downloads with the same bytes"
[[ $(docker exec "$sandbox" head -n 1 "/work/$first/$library_marker-brief.md") == "# $library_marker" ]] || fail "the Library's file is in the Agent's own folder of the work folder"
[[ $(docker exec "$engine_id" head -n 1 "/opt/data/work/$first/$library_marker-brief.md") == "# $library_marker" ]] || fail 'the Engine reads the work folder'
# The planted link is real: on the Engine's mount it reaches the second Agent's memory, which the Library did not read.
docker exec "$engine_id" grep -q "$library_marker-leak" "/opt/data/work/$first/$library_marker-leak.md" || fail "the planted link reaches the second Agent's memory on the Engine"
docker exec "$sandbox" test -L "/work/$first/$library_marker-up" -a -L "/work/$first/$library_marker-mem" -a -f "/work/$first/.$library_marker-hidden" || fail 'the Agent planted its links and its hidden file'
for user in 0 hermes; do
  if docker exec --user "$user" "$engine_id" sh -c 'printf x > "/opt/data/work/$1-engine.txt"' sh "$library_marker" 2> /dev/null; then fail "the Engine cannot write to the work folder (user $user)"; fi
  if docker exec --user "$user" "$engine_id" sh -c 'printf x > "/opt/data/work/$1/$2-engine.txt"' sh "$first" "$library_marker" 2> /dev/null; then fail "the Engine cannot write to an Agent's folder (user $user)"; fi
done
[[ -z $(docker exec "$sandbox" find /work -name "$library_marker-engine.txt") ]] || fail 'nothing the Engine tried to write is in the work folder'
# The Engine pins its sandbox's host key (#393): Hermes's ssh client is hard-coded `StrictHostKeyChecking=accept-new`,
# which trusts an unseen host but refuses a changed one, so the install pre-seeds the Engine's known_hosts with the
# sandbox host key and keeps the key in a volume. A sandbox recreated with another host key is refused on the Engine's
# next command, and putting the key back lets the same Agent's command run again: a swapped sandbox never takes the
# Engine's key and a new one is never trusted unnoticed.
host_key_volume=gtmworks-sandbox-hostkey-first
host_key_saved="$RUNNER_TEMP/sandbox-host-key"
rm -rf "$host_key_saved" && mkdir -p "$host_key_saved"
docker run --rm --user 0 -v "$host_key_volume:/keys:ro" -v "$host_key_saved:/save" --entrypoint sh "$(cat .work-sandbox-image)" -ec 'cp -a /keys/. /save/' \
  || fail "read the sandbox's host key"
wait_sandbox() {
  for attempt in $(seq 1 60); do
    [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox") == healthy ]] && return 0
    sleep 1
  done
  return 1
}
# A fresh Engine is what checks the host key: its process holds no cached connection to the sandbox.
docker stop "$sandbox" > /dev/null || fail 'stop the sandbox to change its host key'
docker run --rm --user 0 -v "$host_key_volume:/keys" --entrypoint sh "$(cat .work-sandbox-image)" -ec '
  rm -f /keys/ssh_host_ed25519_key /keys/ssh_host_ed25519_key.pub
  ssh-keygen -q -t ed25519 -N "" -C gtmworks-work-sandbox-host-changed -f /keys/ssh_host_ed25519_key
  chown 1000:1000 /keys/ssh_host_ed25519_key /keys/ssh_host_ed25519_key.pub
  chmod 600 /keys/ssh_host_ed25519_key
  chmod 644 /keys/ssh_host_ed25519_key.pub
' || fail 'replace the sandbox host key'
docker start "$sandbox" > /dev/null || fail 'start the sandbox with another host key'
wait_sandbox || fail 'the sandbox with another host key is healthy'
docker restart "$engine_id" > /dev/null || fail 'restart the Engine before its next command'
engine_healthy "$engine_id" 180 || fail 'the Engine is healthy with another sandbox host key'
key_marker="sandbox-key-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
engine_node "$engine_key" - sandbox-key "$key_marker" refused < scripts/check-install-profiles.mjs | tee sandbox-key-refused.log \
  || fail "the Engine refuses a sandbox whose host key changed"
if docker exec "$sandbox" test -e "/work/$key_marker-key.txt"; then fail 'a command ran in a sandbox whose host key the Engine did not know'; fi
# The old key back in the volume, and the next command runs again: the refusal was the changed host key, not a sandbox
# that stopped answering.
docker stop "$sandbox" > /dev/null || fail 'stop the sandbox to put its host key back'
docker run --rm --user 0 -v "$host_key_volume:/keys" -v "$host_key_saved:/save" --entrypoint sh "$(cat .work-sandbox-image)" -ec '
  rm -f /keys/ssh_host_ed25519_key /keys/ssh_host_ed25519_key.pub
  cp -a /save/. /keys/
' || fail "put the sandbox's host key back"
docker start "$sandbox" > /dev/null || fail 'start the sandbox with its own host key'
wait_sandbox || fail 'the sandbox is healthy with its own host key'
docker restart "$engine_id" > /dev/null || fail 'restart the Engine before its next command'
engine_healthy "$engine_id" 180 || fail 'the Engine is healthy with its sandbox host key back'
engine_node "$engine_key" - sandbox-key "$key_marker" runs < scripts/check-install-profiles.mjs | tee sandbox-key-runs.log \
  || fail "an Agent's command runs again once the sandbox host key is back"
[[ $(docker exec "$sandbox" cat "/work/$key_marker-key.txt") == "$key_marker" ]] || fail "the Agent's command wrote in the work folder after the host key returned"
# No file sync between the Engine and the sandbox (#393): the ssh backend runs with sync_files off, so nothing of the
# Engine is copied into /home/pn/.hermes (a profile's Skills, the Company's shared Skills, its caches, its memories, its
# settings, or a credential file the sync would carry), and nothing an Agent writes there comes back. An Agent counts the
# files it finds there and writes the paths a sync would map; the job restarts the Engine to tear the session down and
# finds none of it on the Engine or in the sandbox, and the Run itself shows an Agent still works.
engine_change() {
  docker exec "$engine_id" sh -c 'for folder in /opt/data/skills /opt/data/memories /opt/data/profiles/*/skills /opt/data/profiles/*/memories; do
    [ -d "$folder" ] || continue
    grep -rl -- "EDIT-$1" "$folder" 2> /dev/null
  done
  for file in /opt/data/config.yaml /opt/data/profiles/*/config.yaml; do
    [ -f "$file" ] || continue
    grep -l -- "EDIT-$1" "$file" 2> /dev/null
  done; true' sh "$1"
}
# A credential file the sync would copy into the sandbox: the profile's config names it, and it sits in the profile's
# home as a credential file of that profile does.
credential_marker="credential-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
docker exec "$engine_id" sh -ec 'install -d -m 700 -o hermes -g hermes "/opt/data/profiles/$1/sandbox-check-credentials"
  printf "CHECK-%s\n" "$2" > "/opt/data/profiles/$1/sandbox-check-credentials/credential.json"
  chown hermes:hermes "/opt/data/profiles/$1/sandbox-check-credentials" "/opt/data/profiles/$1/sandbox-check-credentials/credential.json"' sh "$first" "$credential_marker" \
  || fail 'write a credential file in the first profile'
sync_marker="sandbox-sync-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
engine_node "$engine_key" - sandbox-sync "$sync_marker" < scripts/check-install-profiles.mjs | tee sandbox-sync.log \
  || fail 'an Agent works in its sandbox with the file sync off'
grep -q '"count":0' sandbox-sync.log || fail 'the Engine copied its files into the sandbox'
# The settings file a sync would map, planted as the sandbox's user: an Agent's own redirect into ~/.hermes/config.yaml
# is a command the Engine holds for a person's approval, so the Run would wait for one and never reply.
docker exec "$sandbox" sh -ec 'printf "# EDIT-%s\n" "$1" > /home/pn/.hermes/config.yaml' sh "$sync_marker" \
  || fail "plant the settings file in the sandbox's Engine home"
# No copy of the profile's credential file anywhere an Agent can write in its sandbox, under any name.
leaked=$(docker exec --user 0 "$sandbox" sh -c 'grep -rl -- "CHECK-$1" /home /work /tmp 2> /dev/null; find / -xdev -name credential.json -path "*sandbox-check-credentials*" 2> /dev/null; true' sh "$credential_marker")
[[ -z $leaked ]] || fail "a credential file of the Engine profile is in the sandbox: $leaked"
before_sync=$(engine_change "$sync_marker") || fail "read the Engine's Skills before the sandbox session ended"
[[ -z $before_sync ]] || fail "an Agent's edit reached the Engine before its session ended: $before_sync"
# The Engine's own process tears the session down at a restart: a stop that never happened cannot pass for one that did.
started_before=$(docker inspect -f '{{.State.StartedAt}}' "$engine_id")
docker restart -t 60 "$engine_id" > /dev/null || fail 'restart the Engine to tear the sandbox session down'
engine_healthy "$engine_id" 180 || fail 'the Engine is healthy after the sandbox session teardown'
[[ $(docker inspect -f '{{.State.StartedAt}}' "$engine_id") != "$started_before" ]] || fail 'the Engine did not restart before its next command'
after_sync=$(engine_change "$sync_marker") || fail "read the Engine's Skills after the sandbox session teardown"
[[ -z $after_sync ]] || fail "what an Agent changed in the sandbox came back to the Engine: $after_sync"
[[ $(docker exec "$engine_id" cat "/opt/data/profiles/$first/sandbox-check-credentials/credential.json") == "CHECK-$credential_marker" ]] \
  || fail 'a credential file of the Engine profile changed with the sandbox session'
# The Company's Screen (#711, vault decision 0068): the Engine holds the sandbox image's own driver the install copied in,
# so the Agent's Run is offered computer_use; asked to open a page on its Screen, the Agent captures the Screen, which
# wakes it inside the sandbox, opens the page on its display and finds its window with computer_use, and display.status on
# the management listener reads it awake on :20 over ssh. The host's Docker then shows the Screen's X server is a process
# of the sandbox and never of the Engine. With the profile's idle stop set short, the Screen goes to sleep by itself, and
# the Agent's next use wakes it again.
engine_driver=$(docker exec "$engine_id" sha256sum /opt/data/screen-driver/cua-driver | cut -d' ' -f1) || fail "the Engine holds a cua-driver"
sandbox_driver=$(docker exec "$sandbox" sh -c 'sha256sum "$(readlink -f "$(command -v cua-driver)")"' | cut -d' ' -f1) || fail "the sandbox image's cua-driver"
[[ -n $engine_driver && $engine_driver == "$sandbox_driver" ]] || fail "the Engine holds the sandbox image's own cua-driver"
screen_marker="screen-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
screen_xvnc() { docker exec "$1" ps -eo args= | awk '/X(tiger)?vnc :20 / {found=1} END {exit !found}'; }
# What the Engine and the sandbox said about the Screen, printed when a Screen step fails.
screen_logs() {
  docker exec "$engine_id" sh -c 'grep -hiE "computer.use|bot.desktop|cua|screen" /opt/data/logs/*.log /opt/data/profiles/*/logs/*.log 2> /dev/null | tail -n 40' >&2 || true
  docker exec "$sandbox" sh -c 'tail -n 20 /tmp/hermes-bot-desktop/*/launcher.log 2> /dev/null; ps -eo args= | grep -iE "vnc|xfce|chrom|cua" | grep -v grep | cut -c1-200' >&2 || true
}
engine_node "$engine_key" - screen-open "$screen_marker" < scripts/check-install-profiles.mjs | tee screen-open.log \
  || { screen_logs; fail "a Run is offered computer_use and the Agent opens a page on the Company's Screen"; }
grep -q '"screen":{"running":true,"display":":20","placement":"terminal:ssh"}' screen-open.log || fail 'display.status reads the Screen awake on :20 inside the sandbox'
screen_xvnc "$sandbox" || fail "the Screen's X server runs in the Company's sandbox"
if screen_xvnc "$engine_id"; then fail "no Screen runs on the Engine"; fi
[[ $(docker exec "$sandbox" cat "/work/$first/$screen_marker-screen.html") == *"SCREEN-$screen_marker"* ]] || fail "the page the Agent opened is in its own folder of the work folder"
engine_node "$engine_key" - screen-sleep "$screen_marker" < scripts/check-install-profiles.mjs | tee screen-sleep.log \
  || { screen_logs; fail 'the idle Screen goes to sleep by itself'; }
grep -q '"screen":{"running":false' screen-sleep.log || fail 'display.status reads the idle Screen asleep'
if screen_xvnc "$sandbox"; then fail "the asleep Screen's X server is stopped"; fi
engine_node "$engine_key" - screen-wake "$screen_marker" < scripts/check-install-profiles.mjs | tee screen-wake.log \
  || { screen_logs; fail "the Agent's next use wakes the Screen"; }
grep -q '"screen":{"running":true,"display":":20","placement":"terminal:ssh"}' screen-wake.log || fail 'display.status reads the Screen awake again'
screen_xvnc "$sandbox" || fail "the woken Screen's X server runs in the sandbox again"
# #713 (ADR 0029): a browser holds the awake Screen's live stream through gtmworks's own address, the gateway, and never
# the Engine's: the RFB handshake from the sandbox's Xvnc, a full picture held for ten seconds, a take and a give-back
# that move the Engine's lease and write the Owner's log rows, and a socket ended in control that gives it back.
engine_node "$engine_key" - screen-live "$screen_marker" < scripts/check-install-profiles.mjs | tee screen-live.log \
  || { screen_logs; fail "a browser holds the Screen's live stream through gtmworks and takes and gives back control"; }
grep -q '"screen":{"width":1440,"height":900}' screen-live.log || fail 'the live stream is the Screen at 1440 by 900'
# Apps (#30), on the first company's profile with no vendor sign-in: the registry's apps are in the pinned
# catalogue, connecting writes only an app's read tools and the way back to gtmworks, an unknown way back is
# expired, and disconnecting turns the app off.
engine_node "$engine_key" - < scripts/check-install-apps.mjs || fail 'apps write only their read tools and come back through gtmworks'
scan_engines
}

# open-design: the Open Design app (#544, ADR 0025), an area of its own beside agents and agents-sandbox, which it would
# take past their time limits (#553). The install, its first run and the second Company are made as the agents area makes them; the first Company's
# main Agent then gets Open Design and makes a design from a Conversation.
open_design() {
cd "$root"
area_setup
reset_install
install_source open-design-install.log || fail 'first install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
engine_id=$(first_engine_id) || fail 'the Engine container'
engine_key=$(first_engine_key)
# The Engine answers a Run with no subscription through the fake model provider served from the web container (#378).
point_engine_at_fake_model "$engine_id"
second_company || fail 'company add makes the second Company'
engine_node "$engine_key" - prepare < scripts/check-install-profiles.mjs | tee prepare-profiles.log || fail 'two companies get two profiles on two Engines with the work tools on, each with one shared space'
first=$(tail -n 1 prepare-profiles.log)
[[ $first =~ ^co-[0-9a-f]{32}$ ]] || fail "the first company's profile name"
sandbox=gtmworks-sandbox-first
# The Open Design app (#544, ADR 0025): turned on for the Agent through the driver, then, after an Engine restart that
# connects it, the Agent is asked for a design from a Conversation. Open Design's daemon in the sandbox draws it through
# its `hermes` runtime, a Run on the Agent's design profile on the Engine over the socket the Engine's ssh session
# forwards. While the call holds, the host's Docker lists both containers' processes: Open Design's MCP command and its
# daemon are processes of the sandbox, and the Engine holds only the ssh client. The design's file is in the Agent's own
# folder of the Company's work folder, and the sandbox holds no provider credential: the fake model's key, which is the
# Engine's model access here, is in no process environment and no file of the sandbox.
od_marker="open-design-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
engine_node "$engine_key" - open-design-add "$od_marker" < scripts/check-install-profiles.mjs \
  || { docker exec "$sandbox" sh -c 'tail -n 40 /home/pn/.gtmworks/open-design/*.log' >&2 || true; fail 'Open Design is turned on for an Agent and Test lists its tools'; }
docker restart "$engine_id" > /dev/null || fail 'restart the Engine'
engine_healthy "$engine_id" 60 || fail 'the Engine is healthy after its restart'
engine_node "$engine_key" - open-design "$od_marker" < scripts/check-install-profiles.mjs > open-design-proof.log 2>&1 &
od_check=$!
od_file="/work/$first/open-design/projects/$od_marker/index.html"
od_drawn=''
for attempt in $(seq 1 600); do
  docker exec "$sandbox" test -f "$od_file" 2> /dev/null && { od_drawn=yes; break; }
  kill -0 "$od_check" 2> /dev/null || break
  sleep 1
done
if [[ $od_drawn != yes ]]; then
  wait "$od_check" || true
  cat open-design-proof.log >&2
  docker exec "$sandbox" sh -c 'tail -n 60 /home/pn/.gtmworks/open-design/*.log; ls -la /home/pn/.gtmworks' >&2 || true
  fail 'an Agent makes a design with Open Design from a Conversation'
fi
sandbox_ps=$(docker exec "$sandbox" ps -eo comm=,args=) || fail 'list the work sandbox processes'
engine_ps=$(docker exec "$engine_id" ps -eo comm=,args=) || fail 'list the Engine processes'
grep -q '/opt/open-design/app/dist/cli\.js mcp --daemon-url' <<< "$sandbox_ps" \
  || { printf '%s\n' "$sandbox_ps" >&2; fail "Open Design's MCP command is a process of the work sandbox"; }
grep -q '/opt/open-design/app/dist/cli\.js --no-open' <<< "$sandbox_ps" \
  || { printf '%s\n' "$sandbox_ps" >&2; fail "Open Design's daemon is a process of the work sandbox"; }
if grep -q 'open-design/app\|dist/cli\.js' <<< "$engine_ps"; then printf '%s\n' "$engine_ps" >&2; fail 'no process of the Engine runs Open Design'; fi
awk '$1 == "ssh" && /pn@sandbox/ && /open-design-mcp/ {found=1} END {exit !found}' <<< "$engine_ps" \
  || { printf '%s\n' "$engine_ps" >&2; fail 'the Engine reaches Open Design over ssh into the sandbox'; }
wait "$od_check" || { cat open-design-proof.log >&2; fail 'an Agent makes a design with Open Design and returns its file'; }
cat open-design-proof.log
docker exec "$sandbox" grep -q "$od_marker" "$od_file" || fail "the design's file is in the Agent's own folder of the Company's work folder"
# No provider credential in the sandbox: the Engine's model key and the Agent's provider key are in no process environment
# and no file there, no provider key variable is set for any process, and no sign-in or key file of the Engine's kind (no
# auth.json, no .env, no Hermes home) is in the work user's home or the work folder, where a synced sign-in would land.
# Each scan is read whole first and a scan that fails fails the check: under pipefail a `grep -q` that stops reading early
# could fail the pipe on a match. They run as the work user, who owns every process and file there: the sandbox drops every
# capability, so its root reads none of the work user's private folders.
# A scan that could not run never reads as one that found nothing (#634): the environments read must hold the scanning
# shell's own, and grep's "no match" (1) is told apart from an error (2 or higher).
sandbox_env=$(docker exec --user pn --env GTMWORKS_SCAN=read "$sandbox" sh -c 'cat /proc/[0-9]*/environ 2> /dev/null | tr "\0" "\n"; true') || fail "read the sandbox's process environments"
grep -qx 'GTMWORKS_SCAN=read' <<< "$sandbox_env" || fail "read the sandbox's process environments"
env_found=0
grep -E "fake-model-key|sk-or-v1-$od_marker|^(OPENAI|ANTHROPIC|OPENROUTER|GEMINI|XAI)_API_KEY=|^CLAUDE_CODE_OAUTH_TOKEN=" <<< "$sandbox_env" > /dev/null || env_found=$?
case $env_found in
  0) fail 'no process of the sandbox holds a provider credential' ;;
  1) ;;
  *) fail "scan the sandbox's process environments" ;;
esac
# Only the files the work user can read are scanned, so a folder it may not open is no error, and a file that went between
# the listing and the read is read again without it; any other grep error is one. A file the scan writes first with a
# marker of its own must be found, so a listing that found nothing fails too.
scan_marker="gtmworks-scan-$od_marker"
sandbox_files=$(docker exec --user pn "$sandbox" sh -c 'printf "%s\n" "$2" > /tmp/gtmworks-scan
  find /home /work /tmp /run -type f -readable -print0 2> /dev/null | xargs -0r sh -c '"'"'
    marker=$1; shift
    grep -Il -e fake-model-key -e "$0" -e "$marker" -- "$@" 2> /dev/null; [ $? -le 1 ] && exit 0
    for file; do [ ! -e "$file" ] || set -- "$@" "$file"; shift; done
    [ $# -gt 0 ] || exit 0
    grep -Il -e fake-model-key -e "$0" -e "$marker" -- "$@"; [ $? -le 1 ] || exit 255'"'"' "$1" "$2"
  found=$?; rm -f /tmp/gtmworks-scan; exit "$found"' sh "sk-or-v1-$od_marker" "$scan_marker") \
  || fail "scan the sandbox's files"
grep -qx /tmp/gtmworks-scan <<< "$sandbox_files" || fail "scan the sandbox's files"
sandbox_files=$(grep -vx /tmp/gtmworks-scan <<< "$sandbox_files" | sort -u) || true
[[ -z $sandbox_files ]] || { printf '%s\n' "$sandbox_files" >&2; fail 'no file of the sandbox holds a provider credential'; }
sandbox_keys=$(docker exec --user pn "$sandbox" find /home/pn /work \( -name auth.json -o -name .env -o -name '.hermes' -o -name 'credentials*.json' \) -print) || fail "list the sandbox's files"
[[ -z $sandbox_keys ]] || { printf '%s\n' "$sandbox_keys" >&2; fail 'no sign-in or key file of the Engine is in the sandbox'; }
}

# backup: backup and restore (#386, #409, ADR 0018): a backup of the install's own data, refused onto an occupied install
# and restored into a fresh one with identities, keys and migration history intact. The backup of every Company's Engine
# and the archives refused for a missing part are the backup-engines area's, on a machine of its own (#553). An archive
# made before Engines existed is the previous release's own, so the update area restores it (#378, C3). The area makes
# the install and the archive it needs (#409): it starts on a fresh isolated Docker machine and completes first run for
# the first Company.
backup() {
cd "$root"
area_setup
# The area makes its own source install (#409): reset what an earlier run left, install, and complete first run as the
# person who installed it, which makes the first Company (Proxy Company) and its Owner.
reset_install
install_source backup-install.log || fail 'backup area install'
complete_setup || fail 'first run before the backup'
# An archive in the shape the release before this one made (#385, #386) is made by that release's own installer in the
# update area, not repacked here from this install's database (#378, C3).
cp .env.install .env.install.before
# The migration history the fresh install must bring back with the archive.
db -c 'select name from gtmworks_install.schema_migrations order by name' > before || fail 'read the migrations before the backup'
# The source install's own backup and restore (#402, #409): seed also writes an Agent's rule and each Company's
# knowledge through the engine contract, and verify reads both back after the restore: they live only in the Hermes
# volume the backup now holds (#349). Identities, the encryption and signing keys, and the migration history come back
# into a fresh empty install from the one archive.
lifecycle seed > data.before || fail 'create and read people, companies, cards and files through APIs'
# An archived Card, Conversation and team channel in each Company (spec #667, ADR 0026): archived is a time and a person
# on each, and the restore keeps every one archived. The channel is archived after its person is in it, as nobody joins
# an archived channel.
db -c "do \$\$ declare k record; person uuid; ch uuid; begin
 select id into person from public.people where name='Restore Person';
 for k in select id,slug from public.companies where slug like 'restore-%' loop
  insert into public.work_cards(company_id,stage_id,title,archived_at,archived_by)
   select k.id,s.id,'Archived '||k.slug,now(),person from public.work_stages s where s.company_id=k.id and s.kind='ideas';
  insert into public.conversations(id,company_id,person_id,agent_name,archived_at,archived_by) values (gen_random_uuid(),k.id,person,'Lead',now(),person);
  ch:=gen_random_uuid();
  insert into public.channels(id,company_id,kind,name,created_by,create_key) values (ch,k.id,'team','Archived '||k.slug,person,gen_random_uuid());
  insert into public.channel_people(channel_id,company_id,person_id,added_by) values (ch,k.id,person,person);
  update public.channels set archived_at=now(),archived_by=person where id=ch;
 end loop; end \$\$" || fail 'archive a Card, a Conversation and a channel before the backup'
archived_rows() { db -c "select k.slug||' '||(select count(*) from public.work_cards w where w.company_id=k.id and w.archived_at is not null and w.archived_by is not null)
 ||' '||(select count(*) from public.conversations v where v.company_id=k.id and v.archived_at is not null and v.archived_by is not null)
 ||' '||(select count(*) from public.channels c where c.company_id=k.id and c.archived_at is not null and c.archived_by is not null)
 from public.companies k where k.slug like 'restore-%' order by k.slug"; }
archived_rows > archived.before || fail 'read the archived rows before the backup'
[[ $(cat archived.before) == $'restore-one 1 1 1\nrestore-two 1 1 1' ]] || fail 'each Company has an archived Card, Conversation and channel before the backup'
# Every Agent's look (#696, ADR 0027), one of them picked: the restore brings back each look, given and picked.
db -c "update public.agent_looks set picked_colour='rose',picked_shape='blob' where agent_id=(select min(agent_id::text)::uuid from public.agent_looks)" || fail 'pick a look before the backup'
looks() { db -c "select agent_id||' '||auto_shape||' '||auto_colour||' '||auto_temperament||' '||coalesce(picked_shape,'-')||' '||coalesce(picked_colour,'-')||' '||coalesce(picked_temperament,'-') from public.agent_looks order by agent_id"; }
looks > looks.before || fail 'read the looks before the backup'
grep -q ' blob rose -$' looks.before || fail 'an Agent has a picked look before the backup'
sh scripts/install.sh backup || fail 'backup'
first_archive=$(find backups -name '*.tgz' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
[[ $(stat -c %a "$first_archive") == 600 ]] || fail 'private backup permissions'
if sh scripts/install.sh restore "$first_archive"; then fail 'restore must refuse an occupied install'; fi
remove_install || fail 'remove first install'
rm .env.install
sh scripts/install.sh || fail 'fresh empty install'
sh scripts/install.sh restore "$first_archive" || fail 'restore'
cmp .env.install.before .env.install || fail 'restore encryption and signing keys'
lifecycle verify > data.after || fail 'read restored people, companies, cards and files through APIs'
diff -u data.before data.after || fail 'restored identities match'
archived_rows > archived.after || fail 'read the archived rows after the restore'
diff -u archived.before archived.after || fail 'the restore keeps archived Cards, Conversations and channels archived'
looks > looks.after || fail 'read the looks after the restore'
diff -u looks.before looks.after || fail "the restore keeps every Agent's look, given and picked"
db -c 'select name from gtmworks_install.schema_migrations order by name' > restored
diff -u before restored || fail 'restored migration history'
}

# backup-engines: the backup of every Company's Engine and work folder (#386, #399, ADR 0018), split from the backup area
# to keep each within its minutes (#553): an install with two Companies, each on its own Engine, its sandbox and its own
# limits, backed up in one archive and restored into a fresh empty install, every Company answering on its own Engine
# again; and an archive naming an Engine without its data, one holding a hard link, and one missing a Company's work
# folder, each refused before anything changes (#378, C4, C15). The area makes its own install, first run, second
# Company and archives.
backup_engines() {
cd "$root"
area_setup
reset_install
install_source backup-engines-install.log || fail 'every-Engine backup area install'
complete_setup || fail 'first run before the every-Engine backup'
# A second Company on an Engine of its own for the every-Engine archive: the first run's Owner is its Owner, and the
# worker gives it its main Agent by itself. It is given its own sandbox limits (#396), which the restore brings back.
second_company scripts/install.sh --memory 1536m --cpus 1.5 || fail 'the second Company for the every-Engine backup'
# Every Company's Engine is in one backup and comes back from it (#386, ADR 0018). Each Company's main Agent is told
# a code word in its own Engine first; after the restore each Company's Agent answers on its own Engine, with its own
# code word and never the other Company's.
engines_memory() {
  db -F ' ' -c "select c.id,a.profile,e.address from public.companies c join public.hermes_agents a on a.company_id=c.id and a.is_default join public.company_engines e on e.id=c.engine_id order by e.created_at"
}
# Every Engine the install has holds a Company by now (the first run's and the one just made).
engines_before=$(ls -d .engines/*/ | wc -l)
[[ $engines_before -ge 2 ]] || fail 'the install has two Engines or more before the backup'
# The worker gives each Company its main Agent on its own profile, so wait for the profile too before writing into the
# Engine's volume: the restore must bring back what its own Engine was given.
for attempt in $(seq 1 240); do
  engines_memory > engines.txt
  [[ $(grep -c . engines.txt || true) == "$engines_before" && $(db -c 'select count(*) from public.company_profiles') -ge "$engines_before" ]] && break
  [[ $attempt == 240 ]] && fail 'every Company gets a main Agent on its own Engine'
  sleep 1
done
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}
  code="backup-${company//-/}"
  docker exec "$container" sh -ec 'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' sh "$profile" "$code" \
    || fail "write a memory in the Engine of $company"
done < engines.txt
# Every Company's work folder is in the same backup (#399): its main Agent's folder gets a file of its own, and a large
# file in each of the tool caches an Agent's commands leave there (`.cache`, `node_modules`), which the archive leaves out.
work_marker="backup-work-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
while read -r company profile address; do
  slug=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
  docker exec "gtmworks-sandbox-$slug" sh -ec '
    mkdir -p "/work/$1/.cache" "/work/$1/site/node_modules/pkg"
    printf "%s" "$2" > "/work/$1/$2.txt"
    head -c 8388608 /dev/urandom > "/work/$1/.cache/$2-cache.bin"
    head -c 1048576 /dev/urandom > "/work/$1/site/node_modules/pkg/$2-module.js"
  ' sh "$profile" "$work_marker-${company//-/}" || fail "write in the work folder of $company"
done < engines.txt
sh scripts/install.sh backup || fail 'backup of every Engine'
every_engine=$(find backups -name '*.tgz' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
[[ -f $every_engine ]] || fail 'the every-Engine backup archive'
# Listed once into a file: under pipefail, grep -q leaving a long listing early makes tar's SIGPIPE fail the check.
tar -tzf "$every_engine" > "$RUNNER_TEMP/every-engine.list" || fail 'list the every-Engine backup'
grep -qx 'engines.list' "$RUNNER_TEMP/every-engine.list" || fail 'the every-Engine backup names the Engines its Companies use'
for folder in .engines/*/; do
  name=${folder#.engines/}; name=${name%/}
  grep -q "^engines/$name/" "$RUNNER_TEMP/every-engine.list" || fail "the backup holds the Engine $name data"
  grep -qx "\.engines/$name/\.env" "$RUNNER_TEMP/every-engine.list" || fail "the backup holds the key of the Engine $name"
done
if grep -qx 'opt/data/' "$RUNNER_TEMP/every-engine.list"; then fail 'the every-Engine backup holds no opt/data'; fi
while read -r company profile address; do
  slug=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
  grep -qx "work/$slug/$profile/$work_marker-${company//-/}.txt" "$RUNNER_TEMP/every-engine.list" || fail "the backup holds the work folder of $company"
done < engines.txt
if grep -E -- "$work_marker-[0-9a-f]+-(cache\.bin|module\.js)\$|^work/.*/(\.cache|node_modules)/" "$RUNNER_TEMP/every-engine.list"; then
  fail 'the backup holds no tool cache of a work folder'
fi
# The install is made empty and the one archive brings both Companies and both Engines back.
remove_install || fail 'remove the install before the every-Engine restore'
rm -f .env.install
sh scripts/install.sh || fail 'fresh install before the every-Engine restore'
SANDBOX_MEMORY=3g SANDBOX_CPUS=3 sh scripts/install.sh restore "$every_engine" || fail 'restore every Engine'
[[ $(ls -d .engines/*/ | wc -l) == "$engines_before" ]] || fail 'the every-Engine restore brings every Engine back'
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME)
  volume=$(engine_value "$folder" VOLUME)
  network=$(engine_value "$folder" NETWORK)
  engine=$(docker ps -q --filter "name=^${name}$")
  [[ -n $engine ]] || fail "the restored install runs the Engine $name"
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Name}}{{end}}{{end}}' "$engine") == "$volume" ]] || fail "the Engine $name keeps its own volume"
  [[ $(docker inspect -f '{{range $other, $_ := .NetworkSettings.Networks}}{{println $other}}{{end}}' "$engine" | grep . | sort) == $(printf '%s\n' "$network" "gtmworks-work-${name#gtmworks-engine-}" | sort) ]] || fail "the Engine $name joins its own network and its work network only"
  # The first run's Company is the first Engine's, the second Company the other's.
  [[ $(db -c "select count(*) from public.companies c join public.company_engines e on e.id=c.engine_id where e.address='http://$name:8642'") -ge 1 ]] || fail "a Company's record names the Engine $name"
  for service in web worker; do
    docker inspect -f '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$(compose ps -q "$service")" | grep -qx "$network" \
      || fail "the $service joins the network of the Engine $name"
  done
  sandbox=$(docker ps -q --filter "name=^gtmworks-sandbox-${name#gtmworks-engine-}$")
  [[ -n $sandbox ]] || fail "the restored install runs the sandbox of $name"
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox") == healthy ]] || fail "the restored sandbox of $name is healthy"
  # Each sandbox comes back with the limits its Company was given, whatever the shell of the restore held (#396).
  if [[ $name == gtmworks-engine-first ]]; then want_limits="$(sandbox_memory_bytes) $(sandbox_nano_cpus)"; else want_limits='1610612736 1500000000'; fi
  [[ $(docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$sandbox") == "$want_limits" ]] || fail "the restored sandbox of $name has its Company's limits"
done
# The restored Engine binds every listener to its install-network address alone again, over every port it listens on:
# the work-network check runs after the restore, on the other side of a restart (#393).
engine_id=$(first_engine_id) || fail 'the restored first Engine container'
work_engine_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$engine_id")
work_web_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$(compose ps -q web)")
docker run --rm --network gtmworks-work-first -e INSTALL_SERVICE_IPS="$(install_service_ips),web=$work_web_ip" -e ENGINE_WORK_IP="$work_engine_ip" \
  -e ENGINE_WORK_PORTS="$(engine_listen_ports "$engine_id")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-work-network.mjs \
  || fail 'after the restore the work network reaches no install service and no Engine listener'
# The restored Engine's key is the one its sandbox takes: the volume came back with the key pair, and known_hosts with it.
docker exec "$(first_engine_id)" cat /opt/data/ssh/id_ed25519 | docker run --rm -i --network gtmworks-work-first --entrypoint sh "$(cat .work-sandbox-image)" -ec '
  set -e
  cat > /tmp/key; chmod 600 /tmp/key
  test "$(ssh -i /tmp/key -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pn@sandbox id -un)" = pn
' || fail 'the restored sandbox accepts its restored Engine key'
# A Run on each Company answers on its own Engine, the code word its own Engine kept reaches its own Run only, and its
# main Agent runs a command in its own Company's sandbox (#399).
restore_marker="restore-run-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
compose exec -T web node --input-type=module - sandbox "$restore_marker" < scripts/check-install-engines.mjs > restore-run.log 2>&1 \
  || { cat restore-run.log; fail 'every Company answers on its own Engine after the restore, and its Agent runs a command in its sandbox'; }
cat restore-run.log
# Each Company's work folder came back into its own sandbox, its files the sandbox's user's, its caches left out; the
# command its Agent ran landed in its own sandbox; and no other Company's sandbox holds either.
while read -r company profile address; do
  slug=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
  file="$work_marker-${company//-/}" ran="$restore_marker-${company//-/}"
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$profile/$file.txt") == "$file" ]] || fail "the restore brings back the work folder of $company"
  [[ $(docker exec "gtmworks-sandbox-$slug" stat -c %u "/work/$profile/$file.txt") == 1000 ]] || fail "the restored work folder of $company belongs to the sandbox's user"
  if docker exec "gtmworks-sandbox-$slug" test -e "/work/$profile/.cache/$file-cache.bin"; then fail "the restore brings back no tool cache of $company"; fi
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$ran.txt") == "$ran" ]] || fail "the Agent of $company runs a command in its own sandbox after the restore"
  while read -r other _ other_address; do
    other_slug=$(printf '%s\n' "$other_address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
    [[ $other_slug == "$slug" ]] && continue
    if docker exec "gtmworks-sandbox-$other_slug" sh -c 'find /work -name "$1*" | grep -q .' sh "$file"; then fail "the work folder of $company comes back into no other Company's sandbox"; fi
    if docker exec "gtmworks-sandbox-$other_slug" test -e "/work/$ran.txt"; then fail "the command of $company's Agent ran in no other Company's sandbox"; fi
  done < engines.txt
done < engines.txt
# An archive naming an Engine without its data cannot be fully restored: it is refused before anything stops or changes.
# The archive keeps its engines.list, so the check that catches it is the manifest one (#378, C4).
incomplete="$RUNNER_TEMP/incomplete-engines"
rm -rf "$incomplete" && mkdir -p "$incomplete"
tar -xzf "$every_engine" -C "$incomplete" || fail 'read the every-Engine archive'
second_folder=$(ls -d .engines/* | grep -v '/first$' | head -n 1)
second_name=${second_folder#.engines/}
rm -rf "$incomplete/engines/$second_name" || fail 'leave an Engine out of the archive'
( cd "$incomplete" && tar -czf "$RUNNER_TEMP/incomplete-engines.tgz" .env.install .engines engines engines.list var/lib/postgresql/data etc/postgresql-custom var/lib/storage ) \
  || fail 'make the incomplete archive'
web=$(compose ps -q web)
engine=$(docker ps -q --filter 'name=^gtmworks-engine-first$')
env_before=$(sha256sum < .env.install)
db -c 'select name from gtmworks_install.schema_migrations order by name' > before-incomplete
if sh scripts/install.sh restore "$RUNNER_TEMP/incomplete-engines.tgz" > incomplete-engines.log 2>&1; then
  cat incomplete-engines.log >&2; fail 'an archive naming an Engine without its data must be refused'
fi
cat incomplete-engines.log
grep -Fq 'The backup does not hold an Engine for every Company.' incomplete-engines.log || fail 'the refusal says the backup does not hold every Engine'
[[ $(compose ps -q web) == "$web" ]] || fail 'the refused restore replaced the web container'
[[ $(docker ps -q --filter 'name=^gtmworks-engine-first$') == "$engine" ]] || fail 'the refused restore stopped no Engine'
[[ $(sha256sum < .env.install) == "$env_before" ]] || fail 'the refused restore changed no setting'
db -c 'select name from gtmworks_install.schema_migrations order by name' | diff -u before-incomplete - || fail 'the refused restore changed no data'
# A real archive with a hard link member, listed by BusyBox in alpine:3.21 as the restore lists it, is refused as an
# unsafe path before anything stops (#378, C15): GNU tar stores the second name of one file as a hard link.
ln "$incomplete/.env.install" "$incomplete/var/lib/storage/hard-link" || fail 'make a hard link in the archive tree'
( cd "$incomplete" && tar -czf "$RUNNER_TEMP/hard-link.tgz" .env.install .engines engines engines.list var/lib/postgresql/data etc/postgresql-custom var/lib/storage ) \
  || fail 'make the hard-link archive'
if sh scripts/install.sh restore "$RUNNER_TEMP/hard-link.tgz" > hard-link.log 2>&1; then
  cat hard-link.log >&2; fail 'an archive with a hard link member must be refused'
fi
grep -Fq 'Unsafe backup path.' hard-link.log || { cat hard-link.log >&2; fail 'the hard link is refused as an unsafe path'; }
[[ $(compose ps -q web) == "$web" ]] || fail 'the refused hard-link restore replaced the web container'
[[ $(docker ps -q --filter 'name=^gtmworks-engine-first$') == "$engine" ]] || fail 'the refused hard-link restore stopped no Engine'
# An archive holding the work folder of one Company and not the other's cannot be fully restored (#399): it is refused
# before anything stops or changes, and every sandbox keeps running with its files.
partial="$RUNNER_TEMP/partial-work"
rm -rf "$partial" && mkdir -p "$partial"
tar -xzf "$every_engine" -C "$partial" || fail 'read the every-Engine archive again'
rm -rf "$partial/work/$second_name" || fail "leave a Company's work folder out of the archive"
( cd "$partial" && tar -czf "$RUNNER_TEMP/partial-work.tgz" .env.install .engines engines work engines.list var/lib/postgresql/data etc/postgresql-custom var/lib/storage ) \
  || fail 'make the archive without one work folder'
sandboxes=$(docker ps -q --filter 'name=^gtmworks-sandbox-' | sort)
if sh scripts/install.sh restore "$RUNNER_TEMP/partial-work.tgz" > partial-work.log 2>&1; then
  cat partial-work.log >&2; fail "an archive without one Company's work folder must be refused"
fi
cat partial-work.log
grep -Fq "The backup does not hold a work folder for every Company's Engine." partial-work.log || fail 'the refusal says the backup does not hold every work folder'
[[ $(compose ps -q web) == "$web" ]] || fail 'the refused work-folder restore replaced the web container'
[[ $(docker ps -q --filter 'name=^gtmworks-sandbox-' | sort) == "$sandboxes" ]] || fail 'the refused work-folder restore stopped no sandbox'
first_profile=$(sed -n 1p engines.txt | cut -d' ' -f2) first_company=$(sed -n 1p engines.txt | cut -d' ' -f1)
docker exec gtmworks-sandbox-first test -e "/work/$first_profile/$work_marker-${first_company//-/}.txt" || fail 'the refused work-folder restore changed no work folder'
}

# proxy: the public address behind a proxy (issue #40, #41): first run, the emailed sign-in and invitation links on
# APP_ORIGIN over HTTPS, and the sign-in rate limit per visitor behind it.
proxy() {
cd "$root"
area_setup
# A remote server (README): a fresh install whose APP_ORIGIN is the https origin of a proxy in front of the gateway.
# First run and the emailed sign-in link must stay on that origin and reach the Company home, and so must the
# invitation link and a sign-in link requested with a forged X-Forwarded-Host (issue #40). The area makes its own fresh
# install (#406): the public origin is in the settings before the first install runs, and no earlier area's install is
# needed or kept.
public=https://app.gtmworks.test:4443
reset_install
docker run --rm -v "$root/lib:/code:ro" node:22.14.0-alpine3.21 node /code/install-env.mjs generate > .env.install
chmod 600 .env.install
sed -i -e "s#^APP_ORIGIN=.*#APP_ORIGIN=$public#" -e "s#^SUPABASE_PUBLIC_URL=.*#SUPABASE_PUBLIC_URL=$public#" .env.install || fail 'set the public origin'
{ sh scripts/install.sh || fail 'proxied install'; } 2>&1 | tee proxied-install.log
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
[[ $(tail -n 1 proxied-install.log) == "Set up gtmworks with this one-time link: $public/first-run#code=$code" ]] || fail 'the proxied install prints its setup link on the public origin'
printf '%s\n' '{' '  local_certs' '  auto_https disable_redirects' '}' 'app.gtmworks.test:4443 {' '  reverse_proxy 127.0.0.1:3000' '}' > Caddyfile
docker run -d --name install-proxy --network host -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 >/dev/null || fail 'start the HTTPS proxy'
for attempt in $(seq 1 60); do docker exec install-proxy cat /data/caddy/pki/authorities/local/root.crt > ca.crt 2>/dev/null && [[ -s ca.crt ]] && break; sleep 1; done
[[ -s ca.crt ]] || { docker logs install-proxy; fail 'HTTPS proxy certificate authority'; }
docker run --rm -i --network host --add-host app.gtmworks.test:127.0.0.1 -v "$PWD/ca.crt:/ca.crt:ro" \
  --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) --env-file <(grep -E '^SETUP_CODE=' .env.install) \
  -e NODE_EXTRA_CA_CERTS=/ca.crt -e APP_ORIGIN="$public" -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < scripts/check-install-proxy.mjs || { docker logs install-proxy; fail 'first run, sign-in and invitation links through the HTTPS proxy'; }
# Repeated wrong passwords for that Owner hit the auth service's own rate limit (issue #41), per visitor behind the
# proxy. Caddy writes each visitor's address in X-Forwarded-For, replacing any a client sent; the gateway believes
# it only from the install network's bridge gateway, where every connection from this machine arrives from
# (scripts/install-gateway-real-ip.sh). A browser signs in on the real page through the proxy, goes past the limit
# with forged client addresses, and the page says to try again later. Another visitor, inside the install network,
# still has its own allowance and signs in; its own forged addresses buy nothing, so it is limited in turn; and the
# browser's address is still limited after that.
docker run --rm --network host --ipc=host --add-host app.gtmworks.test:127.0.0.1 -v "$PWD:$PWD" -w "$PWD" --env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install) \
  -e APP_ORIGIN="$public" -e SIGN_IN_EMAIL=proxy-owner@example.com \
  mcr.microsoft.com/playwright:v1.64.1-noble npx --no-install playwright test -c playwright.install.config.ts || { docker logs install-proxy; fail 'the sign-in page past the auth rate limit through the HTTPS proxy'; }
docker run --rm --network gtmworks-install_default -v "$PWD/scripts:/check/scripts:ro" --env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install) \
  -e APP_ORIGIN=http://gateway:8080 -e SIGN_IN_EMAIL=proxy-owner@example.com -e SIGN_IN_PASSWORD=proxy-owner-password \
  node:22.14.0-alpine3.21 node /check/scripts/check-install-rate-limit.mjs fresh || fail 'another visitor keeps its own sign-in allowance'
docker run --rm --network gtmworks-install_default -v "$PWD/scripts:/check/scripts:ro" --env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install) \
  -e APP_ORIGIN=http://gateway:8080 -e SIGN_IN_EMAIL=proxy-owner@example.com \
  node:22.14.0-alpine3.21 node /check/scripts/check-install-rate-limit.mjs untrusted || fail 'forged addresses from inside the install network are ignored'
docker run --rm --network host --add-host app.gtmworks.test:127.0.0.1 -v "$PWD/ca.crt:/ca.crt:ro" -v "$PWD/scripts:/check/scripts:ro" --env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install) \
  -e NODE_EXTRA_CA_CERTS=/ca.crt -e APP_ORIGIN="$public" -e SIGN_IN_EMAIL=proxy-owner@example.com \
  node:22.14.0-alpine3.21 node /check/scripts/check-install-rate-limit.mjs limited || { docker logs install-proxy; fail 'the limited visitor stays limited despite forged addresses'; }
}

# update: the update between releases (#49, #378): the failed update at the end of the install step, which rolls back
# and leaves the old release serving, then a release install of the last release before the Engines from its two files,
# its update to this release and to the next, the backup that release's installer made restored onto this release
# (#378, C3), and the update that pins another Engine image.
# rollback: this release's installer rolls a failed migration back and leaves the release it was running serving. Its own
# area since the work sandbox image (#389) made the update area's whole run longer than its 12 minutes: it needs only a
# source install, none of the releases the update area makes.
rollback() {
cd "$root"
area_setup
reset_install
install_source source-install.log || fail 'source install before the failed update'
old_web=$(compose ps -q web)
cp scripts/install-failing-migration.sql supabase/migrations/99999999999999_failure.sql
# The failing migration leaves the checkout as soon as the update tried it, failed or not, so no later area in it meets
# the fixture.
if sh scripts/install.sh update "$INSTALL_REF" > update.log 2>&1; then remove_failing_migration; fail_update 'update must fail'; fi
remove_failing_migration
grep -Fq 'Applying migration: 99999999999999_failure.sql' update.log || fail_update 'failed migration name'
[[ $(compose ps -q web) == "$old_web" ]] || fail_update 'old web container still serving'
[[ $(db -c "select to_regclass('public.update_should_rollback') is null") == t ]] || fail_update 'migration transaction rolled back'
status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health) || fail_update 'old version health request'
[[ $status == 200 ]] || fail_update 'old version healthy after failed update'
}

# The previous release installed in release-install/ from its own two files, its first run made, a memory written in
# the Company's profile and a sign-in on its Engine, and the archive its own installer makes of it: what the update area
# updates and the previous-archive area restores. It leaves the shell in that folder with key, company, profile, marker
# and previous_backup set.
previous_release_install() {
# The previous release is the last one before each Company got its own Engine (spec #378): its own schema (no Engine
# record, no companies.engine_id), its own one `hermes` service, and its own key in .env.install. It is a fixed commit
# (previous_release_commit, scripts/ci-install-lib.sh), not this pull request's base or origin/main: after this release
# merges, main has the Engines, and the update proof would build this release's own shape twice and prove nothing (#378, C1).
previous_release=$previous_release_commit
git cat-file -e "$previous_release^{commit}" 2> /dev/null || git fetch --no-tags origin "$previous_release" || fail 'the previous release commit'
# The update and previous-archive areas each make this install in the same places: one that ran before this one in
# the same checkout (./ci.sh install, all of them) leaves its worktree and folder, which go first.
# An install an earlier area left running there was taken down by the area's reset_install, from its own folder.
git worktree remove --force "$RUNNER_TEMP/previous-release" > /dev/null 2>&1 || true
docker run --rm -v "$RUNNER_TEMP:/temp" -v "$root:/root-folder" alpine:3.21 rm -rf /temp/previous-release /root-folder/release-install /root-folder/release-previous
git worktree prune
git worktree add "$RUNNER_TEMP/previous-release" "$previous_release" || fail 'the previous release checkout'
release_image "$previous_release" localhost:5000/gtmworks:0.0.0-main "$RUNNER_TEMP/previous-release" || fail 'build the previous release image'
previous=$(publish 0.0.0-main) || fail 'push the previous release image'
( cd "$RUNNER_TEMP/previous-release" && node scripts/release-assets.mjs "$previous" "$root/release-previous" ) || fail 'previous release files'
publish_releases
echo "previous release: $previous; this release: $first; next release: $next"
dir="$PWD/release-install"
mkdir "$dir" && cp release-previous/docker-compose.install.yml release-previous/install.sh "$dir/" || fail 'release install directory'
[[ $(ls -A "$dir" | wc -l) == 2 ]] || fail 'the release install directory holds only the two release files'
sh "$dir/install.sh" || fail 'the previous release install'
cd "$dir"
# The previous release's own shape: its Engine key in .env.install, its one `hermes` service, and no .engines/.
key=$(sed -n 's/^HERMES_API_KEY=//p' .env.install)
[[ $key =~ ^[a-f0-9]{64}$ ]] || fail 'the previous release keeps its Engine key in .env.install'
[[ ! -e .engines ]] || fail 'the previous release has no Engine folders'
[[ -n $(docker ps -q --filter 'name=^gtmworks-install-hermes-1$') ]] || fail 'the previous release runs its Engine'
# First run as the person who installed it: the Company and its main Agent, on the previous release's Engine.
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) \
  -e SETUP_CODE="$code" -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" \
  || fail 'first run on the previous release'
company=$(db -c "select id from public.companies where name='Proxy Company'") || fail 'read the previous release Company'
[[ -n $company ]] || fail 'first run made the previous release Company'
profile=co-${company//-/}
for attempt in $(seq 1 180); do
  if docker run --rm --network gtmworks-install_default curlimages/curl:8.12.1 -sf -H "Authorization: Bearer $key" http://hermes:9119/api/profiles \
    | grep -qF "$profile"; then break; fi
  if [[ $attempt == 180 ]]; then fail 'the worker made the Company profile in the previous release Engine'; fi
  sleep 1
done
# What the Agent was told, and the sign-in the Company made, before the update: both live in the Engine's data,
# which the update must carry over (#385, ADR 0018).
marker="release-update-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
tell_engine gtmworks-install-hermes-1 "$profile" "$marker" || fail "write a memory in the Company's profile"
sign_in_engine gtmworks-install-hermes-1 || fail 'sign the Company in on the Engine before the update'
# The backup the previous release's own installer makes of its one-Company install, kept before the update (#378, C3): it
# holds that release's own shape (one Engine at opt/data, its key in .env.install, no .engines/), so restoring it is a
# real archive made before the Engines, not one repacked from this release's database.
mkdir -p "$RUNNER_TEMP/previous-release-backup"
sh install.sh backup "$RUNNER_TEMP/previous-release-backup" > "$RUNNER_TEMP/previous-release-backup.log" 2>&1 \
  || { cat "$RUNNER_TEMP/previous-release-backup.log"; fail 'the previous release backup'; }
previous_backup=$(sed -n 's/^Backup: //p' "$RUNNER_TEMP/previous-release-backup.log" | tail -n 1)
[[ -f $previous_backup ]] || fail 'the previous release backup archive'
tar -tzf "$previous_backup" > "$RUNNER_TEMP/previous-release.list" || fail 'list the previous release backup'
grep -Eq '^opt/data(/|$)' "$RUNNER_TEMP/previous-release.list" || fail 'the previous release backup holds the Agents data at opt/data'
if grep -Eq '^\.?engines' "$RUNNER_TEMP/previous-release.list"; then fail 'the previous release backup holds no Engine folders'; fi
}

# update: the update between releases, from the last release before the Engines to this one and the next. Its summary
# does not print, and it runs without pipefail, as the release checks always did.
update() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
previous_release_install
# Two Companies on the previous release's schema (#378, S2): the update is refused before it migrates, replaces
# or restarts anything, and the release it runs keeps serving.
db -c "insert into public.companies (id,slug,name) values ('00000000-0000-4000-8000-000000000239','release-probe','Release probe');" \
  || fail 'a second Company on the previous release schema'
[[ $(db -c 'select count(*) from public.companies') == 2 ]] || fail 'the previous release install has two Companies'
web=$(compose ps -q web)
serving=$(cat .install-release)
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
if sh install.sh update > "$RUNNER_TEMP/several-companies.log" 2>&1; then
  cat "$RUNNER_TEMP/several-companies.log"
  fail 'an update of a previous release install with two Companies must be refused'
fi
cat "$RUNNER_TEMP/several-companies.log"
grep -F 'This install has 2 Companies on one Engine.' "$RUNNER_TEMP/several-companies.log" || fail 'the refusal names how many Companies it found'
grep -F 'Each Company now needs its own Engine' "$RUNNER_TEMP/several-companies.log" || fail 'the refusal says each Company needs its own Engine'
grep -F 'this release has no path for an install with more than one Company' "$RUNNER_TEMP/several-companies.log" || fail 'the refusal says this release has no path for it'
[[ $(compose ps -q web) == "$web" ]] || fail 'the refused update replaced the previous release web container'
[[ $(cat .install-release) == "$serving" ]] || fail 'the refused update left the release it runs'
[[ $(db -c "select to_regclass('public.company_engines') is null") == t ]] || fail 'the refused update applied no migration'
[[ $(db -c 'select count(*) from public.companies') == 2 ]] || fail 'the refused update left the Companies'
[[ ! -e .engines ]] || fail 'the refused update made no Engine folder'
for path in /api/health /sign-in; do
  status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request after the refusal"
  [[ $status == 200 ]] || fail "$path returned HTTP $status after the refused update (expected 200)"
done
# The probe Company goes with every row the previous release made for it (its board stages and the like), in one
# transaction and with foreign keys held off, so no row is left naming a Company that is gone.
db -c "begin; set local session_replication_role=replica;
  do \$\$ declare t record; begin
   for t in select c.table_name from information_schema.columns c join information_schema.tables b
     on b.table_schema=c.table_schema and b.table_name=c.table_name and b.table_type='BASE TABLE'
     where c.table_schema='public' and c.column_name='company_id' and c.table_name<>'companies' loop
    execute format('delete from public.%I where company_id=%L',t.table_name,'00000000-0000-4000-8000-000000000239');
   end loop; end \$\$;
  delete from public.companies where id='00000000-0000-4000-8000-000000000239'; commit;" || fail 'remove the probe Company'
[[ $(db -c 'select count(*) from public.companies') == 1 ]] || fail 'the previous release install has its one Company again'
# The code word scripts/check-install-engines.mjs looks for (lib/engine-targets.mjs), told to the Company's Agent before the update.
docker exec -i gtmworks-install-hermes-1 sh -ec 'printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"' sh "$profile" "backup-${company//-/}" \
  || fail "write the code word in the Company's profile"
# An update to a release whose Engine does not start (#502): the previous release made no Engine template to put back,
# so the update starts its one `hermes` Engine again, which it only stopped, on the network its app and worker reach it
# by, with its data, its key in .env.install and no Engine folder; nothing of the new Engine or its sandbox stays.
publish_broken_engine_release
cp "$root/release-broken-engine/docker-compose.install.yml" "$root/release-broken-engine/install.sh" . || fail 'the release files whose Engine does not start in place'
if GTMWORKS_ENGINE_WAIT=40 sh install.sh update > update.log 2>&1; then fail_update 'the update from the one-Engine release whose Engine does not start must fail'; fi
grep -Fq 'the previous release keeps serving, with its own Engines again' update.log || fail_update 'the update from the one-Engine release whose Engine does not start says the previous release keeps serving'
# The release files of a failed update stay in the folder; the previous release's own go back by hand, as staged-update does.
cp "$root/release-previous/docker-compose.install.yml" "$root/release-previous/install.sh" . || fail 'the previous release files back'
[[ $(compose ps -q web) == "$web" ]] || fail_update 'the failed update leaves the previous release web container serving'
probe 'after the update from the one-Engine release whose Engine does not start'
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' gtmworks-install-hermes-1) == healthy ]] || fail_update "the previous release's hermes Engine serves again"
[[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Name}}{{end}}{{end}}' gtmworks-install-hermes-1) == gtmworks-install_hermes ]] || fail_update 'the hermes Engine keeps its volume'
[[ $(sed -n 's/^HERMES_API_KEY=//p' .env.install) == "$key" ]] || fail_update 'the Engine key is back in .env.install'
[[ ! -e .engines ]] || fail_update 'the failed update leaves no Engine folder'
[[ -z $(docker ps -aq --filter 'name=^gtmworks-(engine|sandbox|exit|screen-driver)-first$') ]] || fail_update "the failed update leaves no Engine, sandbox or exit of the template"
if docker volume inspect gtmworks-work-first > /dev/null 2>&1; then fail_update 'the failed update leaves no work folder'; fi
if docker network inspect gtmworks-engine-first > /dev/null 2>&1; then fail_update "the failed update leaves no Engine network"; fi
docker run --rm --network gtmworks-install_default curlimages/curl:8.12.1 -sf -H "Authorization: Bearer $key" http://hermes:9119/api/profiles \
  | grep -qF "$profile" || fail_update "the hermes Engine answers on the previous release's network with its key and the Company profile"
compose exec -T web node --input-type=module -e "const answer=await fetch('http://hermes:8642/health'); if(!answer.ok) process.exit(1);" < /dev/null \
  || fail_update 'the previous release app reaches its hermes Engine'
docker exec gtmworks-install-hermes-1 grep -qF "$marker" "/opt/data/profiles/$profile/memories/MEMORY.md" || fail_update "the hermes Engine keeps what the Agent was told"
# The update to this release: it applies the migrations (including the Engine records), adopts the Engine the
# previous release ran, and leaves the Company answering from its record.
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
sh install.sh update || fail 'release update'
[[ $(first_engine_key) == "$key" ]] || fail 'the update adopted the Engine key'
if grep -q '^HERMES_API_KEY=' .env.install; then fail 'the update left no Engine key in .env.install'; fi
engine=$(first_engine_id)
[[ -n $engine ]] || fail "the updated install runs the Company's Engine"
[[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Name}}{{end}}{{end}}' "$engine") == gtmworks-install_hermes ]] || fail 'the Engine keeps the volume the previous release used'
hermes_image=$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)
[[ $(docker inspect -f '{{.Config.Image}}' "$engine") == "$hermes_image" ]] || fail 'the Engine runs the template image'
! publishes_host_port "$engine" || fail 'the Engine publishes no host port'
[[ $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$engine" | grep . | sort) == $'gtmworks-engine-first\ngtmworks-work-first' ]] || fail "the Engine joins its install network and its work network only"
for service in web worker; do
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$(compose ps -q "$service")" | grep -qx gtmworks-engine-first \
    || fail "the $service joins the Engine's network"
  if docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' "$(compose ps -q "$service")" | grep -qx gtmworks-work-first; then
    fail "the $service stays off the work network"
  fi
done
docker run --rm --network gtmworks-engine-first -e INSTALL_SERVICE_IPS="$(install_service_ips)" -v "$root/scripts:/check:ro" \
  node:22.14.0-alpine3.21 node /check/check-install-engine-network.mjs || fail "the adopted Engine's network reaches no install service"
if docker ps -aq --filter 'label=com.docker.compose.project=gtmworks-install' --filter 'label=com.docker.compose.service=hermes' | grep -q .; then
  fail 'the container the previous release ran the Engine in is retired'
fi
# The Company's sandbox is born by the update, on a volume the previous release made: it runs the image the install
# recorded, is healthy, and its Engine's key is the one made in that volume.
adopted_sandbox=$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')
[[ -n $adopted_sandbox ]] || fail 'the update starts the Company sandbox'
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$adopted_sandbox") == healthy ]] || fail 'the updated sandbox is healthy'
[[ $(docker inspect -f '{{.Config.Image}}' "$adopted_sandbox") == "$(cat .work-sandbox-image)" ]] || fail 'the updated sandbox runs the image the install recorded'
[[ $(docker exec "$engine" stat -c %u /opt/data/ssh/id_ed25519) == 10000 ]] || fail "the adopted Engine holds its sandbox key"
docker exec "$engine" cat /opt/data/ssh/id_ed25519 | docker run --rm -i --network gtmworks-work-first --entrypoint sh "$(cat .work-sandbox-image)" -ec '
  set -e
  cat > /tmp/key; chmod 600 /tmp/key
  test "$(ssh -i /tmp/key -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pn@sandbox id -un)" = pn
' || fail 'the updated sandbox accepts its Engine key'
compose exec -T -e EXPECTED_KEY="$key" web node --input-type=module -e "const {engineOf}=await import('/app/lib/company-engine.mjs'); const at=await engineOf('$company'); console.log(at?.address==='http://gtmworks-engine-first:8642'&&at?.key===process.env.EXPECTED_KEY?'record':'no');" \
  | grep -qx record || fail "the updated install's Company answers from its Engine record with the adopted key"
[[ $(db -c "select count(*) from public.company_engines e join public.companies c on c.engine_id=e.id where c.id='$company'") == 1 ]] \
  || fail 'the updated install keeps the Company Engine record'
# #384: `gtmworks sign-in claude --company` reaches that Company's Engine and prints the provider's address; no
# code is pasted, so the sign-in is not finished.
timeout 120 sh "$root/scripts/get.sh" --command --dir "$dir" sign-in claude --company "$company" < /dev/null > "$RUNNER_TEMP/sign-in.log" 2>&1 || true
cat "$RUNNER_TEMP/sign-in.log"
grep -F "Signing Proxy Company in to Claude on its Engine: gtmworks-engine-first." "$RUNNER_TEMP/sign-in.log" || fail 'gtmworks sign-in reaches the Company Engine'
grep -Eq 'https://(claude\.ai|console\.anthropic\.com)' "$RUNNER_TEMP/sign-in.log" || fail 'gtmworks sign-in prints the provider address'
# The Agent still remembers what it was told, and the Company's sign-in still serves its Agents, from the
# Engine the update adopted.
ENGINE_KEY="$key" compose exec -T -e ENGINE_KEY web node --input-type=module - "$marker" < "$root/scripts/check-install-update.mjs" \
  || fail "the Agent remembers what it was told and the Company's sign-in still serves"
# The Agent made before the update runs a command in its Company's new sandbox and still remembers (#397).
compose exec -T web node --input-type=module - sandbox "$marker" < "$root/scripts/check-install-engines.mjs" \
  && [[ $(docker exec gtmworks-sandbox-first cat "/work/$marker-${company//-/}.txt") == "$marker-${company//-/}" ]] \
  || fail "the Agent made before the update runs a command in its Company's sandbox and still remembers"
# The next release's migration is applied through the running database's bind mount.
cp "$root/release-next/docker-compose.install.yml" "$root/release-next/install.sh" . || fail 'next release files in place'
sh install.sh update || fail 'next release update'
[[ $(db -c "select to_regclass('gtmworks_install.release_update_probe') is not null") == t ]] \
  || fail 'the next release migration applied through the running bind mount'
compose exec -T db ls /migrations | sort > "$RUNNER_TEMP/seen" || fail 'list the migrations the database sees'
ls supabase/migrations | sort > "$RUNNER_TEMP/expected"
diff -u "$RUNNER_TEMP/expected" "$RUNNER_TEMP/seen" || fail 'the running database sees the next release migrations'
[[ $(cat .install-release) == "$next" ]] || fail 'the update records the release it runs'
for path in /api/health /sign-in; do
  status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request"
  [[ $status == 200 ]] || fail "$path returned HTTP $status after the release update (expected 200)"
done
# Running the install command again keeps the adopted Engine: the same key, the same record, the same container.
cp .env.install .env.install.before
sh install.sh || fail 'the install command again'
cmp .env.install .env.install.before || fail 'the install command again leaves .env.install as it was'
[[ $(first_engine_key) == "$key" ]] || fail 'the install command again keeps the adopted Engine key'
[[ $(first_engine_id) == "$engine" ]] || fail 'the install command again leaves the adopted Engine running'
[[ $(docker ps -q --filter 'name=^gtmworks-sandbox-first$') == "$adopted_sandbox" ]] || fail 'the install command again leaves the sandbox running'
}

# previous-archive: the archive the previous release's own installer made, restored onto a fresh install of this release
# (#378, C3). Its own area since the work sandbox (#389) took the update area past its 12 minutes; it makes the same
# previous release install the update area does, from the same fixed commit.
previous_archive() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
previous_release_install
# The archive the previous release's own installer made, restored onto a fresh install of this release (#378, C3): the one
# Company it holds reaches its own Engine, and its Agent remembers what it was told and its sign-in still serves, all of it
# from data written before the Engines existed.
compose down -v || fail 'remove the previous release install before its archive'
remove_engine
rm -f .env.install
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
sh install.sh || fail 'fresh install before the previous release archive'
sh install.sh restore "$previous_backup" || fail 'restore the archive the previous release made'
[[ $(ls -d .engines/*/ | wc -l) == 1 ]] || fail 'the previous release archive restores its one Engine'
[[ $(db -c 'select count(*) from public.companies') == 1 ]] || fail 'the previous release archive restores its one Company'
[[ $(first_engine_key) == "$key" ]] || fail 'the previous release archive keeps the key it held in .env.install'
if grep -q '^HERMES_API_KEY=' .env.install; then fail 'the restored install keeps no Engine key in .env.install'; fi
# The key left the app's and the worker's environment before they were recreated (#378, X3): a pre-#385 archive's key is
# never in their environment for even one start, and the restored Engine answers on its own.
for service in web worker; do
  if docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(compose ps -q "$service")" | grep -q '^HERMES_API_KEY='; then
    fail "the $service starts with no Engine key in its environment"
  fi
done
[[ -n $(first_engine_id) ]] || fail 'the restored install runs its one Engine'
company=$(db -c "select id from public.companies where name='Proxy Company'") || fail 'read the Company the archive restored'
[[ $(db -c "select count(*) from public.company_engines e join public.companies c on c.engine_id=e.id where c.id='$company'") == 1 ]] \
  || fail 'the Company the previous release archive restored names its own Engine'
engine_node "$key" - < "$root/scripts/check-install-conversation.mjs" \
  || fail 'the Company the previous release archive restored answers on its own Engine'
ENGINE_KEY="$key" compose exec -T -e ENGINE_KEY web node --input-type=module - "$marker" < "$root/scripts/check-install-update.mjs" \
  || fail 'the Company the previous release archive restored answers on its own Engine and its Agent remembers'
# An archive made before the work sandbox holds no work folder (#399): the restored Company gets an empty one, which its
# sandbox runs on, healthy, and which its Engine reaches as every Agent's command does.
sandbox=$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')
[[ -n $sandbox && $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox") == healthy ]] \
  || fail 'the Company the previous release archive restored has a healthy work sandbox'
[[ -z $(docker exec "$sandbox" find /work -mindepth 1 -type f) ]] || fail 'the Company the previous release archive restored gets an empty work folder'
docker exec -u hermes "$(first_engine_id)" ssh -i /opt/data/ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/opt/data/.ssh/known_hosts -o LogLevel=ERROR -p 2222 pn@sandbox true \
  || fail 'the Engine the previous release archive restored reaches its work sandbox'
}

# release-update: the update a stable install really takes (#483): the latest published release, read from GitHub's
# releases list on every run (lib/updates.mjs latestStableRelease, the release Update ready offers and `gtmworks update`
# installs), installed from its own two published files and the images they pin, first run made and an Agent told a
# fact, then updated to this release. The update and previous-archive areas build a fixed commit to prove one shape's
# path (#378, C1); this area moves with each release, so its checks hold for any release's shape: the install it made
# keeps its one Company, its Owner and what the Agent was told, runs this release with every migration, and the install
# command again keeps it.
release_update() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
publish_releases
dir="$PWD/stable-release-install"
docker run --rm -v "$root:/root-folder" alpine:3.21 rm -rf /root-folder/stable-release-install
stable=$(node scripts/latest-release.mjs "$dir") || fail 'the latest published release and its two files'
echo "latest published release: $stable; this release: $first"
[[ $(ls -A "$dir" | wc -l) == 2 ]] || fail 'the release install directory holds only the two release files'
sh "$dir/install.sh" || fail "install $stable from its two published files"
cd "$dir"
[[ $(cat .install-release) == "$(sed -n 's/^release_image=//p' install.sh)" ]] || fail "the install runs the image $stable pins"
probe "on $stable"
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SETUP_CODE)=' .env.install) \
  -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" || fail "first run on $stable"
company=$(db -c "select id from public.companies where name='Proxy Company'") || fail "read the Company $stable made"
[[ -n $company ]] || fail "first run made the Company on $stable"
people=$(db -c "select person_id||' '||role from public.members where company_id='$company' order by 1") || fail "read the Company's people on $stable"
# The Engine the release runs, in its own shape: one per Company from its own folder (ADR 0018), or the one `hermes`
# service of the releases before it. The worker makes the Company's profile there.
if [[ -f .engines/first/.env ]]; then engine_before=$(engine_value .engines/first NAME); else engine_before=gtmworks-install-hermes-1; fi
profile=co-${company//-/}
for attempt in $(seq 1 180); do
  docker exec "$engine_before" test -d "/opt/data/profiles/$profile" 2> /dev/null && break
  [[ $attempt == 180 ]] && fail "the worker made the Company profile in the Engine $stable runs"
  sleep 1
done
# What the Agent was told, and the sign-in the Company made, before the update: both live in the Engine's data.
marker="stable-update-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
tell_engine "$engine_before" "$profile" "$marker" || fail "write a memory in the Company's profile on $stable"
sign_in_engine "$engine_before" || fail "sign the Company in on its Engine on $stable"
# A Company whose own sandbox memory is below this release's default, as the release before the Screens wrote it (#711):
# the update raises it to the default. A release of the one-Engine shape (before ADR 0018) keeps no Company limits at all,
# so its Company follows the default and only the sandbox's memory is read after the update.
lowered=no
if [[ -f .engines/first/.env ]]; then
  lowered=yes
  { grep -Ev '^SANDBOX_MEMORY(_DEFAULT)?=' .engines/first/.env; echo 'SANDBOX_MEMORY=1g'; } > .engines/first/.env.low && mv .engines/first/.env.low .engines/first/.env \
    || fail "give the Company a memory limit below the default on $stable"
fi
# The update to this release, as a stable install takes it: this release's two files in place of the old ones, then update.
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
sh install.sh update || fail "the update from $stable to this release"
[[ $(cat .install-release) == "$first" ]] || fail 'the update records this release'
probe "after the update from $stable"
[[ $(db -c 'select id from public.companies') == "$company" ]] || fail "the update keeps the one Company $stable made"
[[ $(db -c "select person_id||' '||role from public.members where company_id='$company' order by 1") == "$people" ]] || fail "the update keeps the Company's people and their roles"
compose exec -T db ls /migrations | sort > "$RUNNER_TEMP/stable-seen" || fail 'list the migrations the database sees'
ls "$root/supabase/migrations" | sort > "$RUNNER_TEMP/stable-expected"
diff -u "$RUNNER_TEMP/stable-expected" "$RUNNER_TEMP/stable-seen" || fail "the updated database sees this release's migrations"
# Every one of them is applied, not only mounted: the names the installer records once a migration ran, its cutovers
# included, every file but the .verify.sql checks (scripts/install.sh apply_migrations).
grep -v '\.verify\.sql$' "$RUNNER_TEMP/stable-expected" > "$RUNNER_TEMP/stable-to-apply"
migrations | sort > "$RUNNER_TEMP/stable-applied" || fail 'read the applied migrations'
diff -u "$RUNNER_TEMP/stable-to-apply" "$RUNNER_TEMP/stable-applied" || fail "the update from $stable applies every migration of this release"
key=$(first_engine_key)
engine=$(first_engine_id)
[[ -n $key && -n $engine ]] || fail "the updated install runs the Company's Engine from its own folder"
[[ $(db -c "select count(*) from public.company_engines e join public.companies c on c.engine_id=e.id where c.id='$company'") == 1 ]] \
  || fail 'the updated Company names its own Engine'
sandbox=$(docker ps -q --filter 'name=^gtmworks-sandbox-first$')
[[ -n $sandbox && $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox") == healthy ]] || fail "the updated Company's work sandbox is healthy"
[[ $(docker inspect -f '{{.Config.Image}}' "$sandbox") == "$(cat .work-sandbox-image)" ]] || fail 'the updated sandbox runs the image the install recorded'
# #711: the Company's lower memory limit, when its release kept one, is raised to this release's default, and its sandbox
# runs with the default either way.
default_memory=$(sed -n 's/^    mem_limit: ${SANDBOX_MEMORY:-\([0-9]*\)g}$/\1/p' scripts/engine-template.yml)
[[ -n $default_memory ]] || fail "this release's default sandbox memory, in gigabytes"
if [[ $lowered == yes ]]; then
  [[ $(sed -n 's/^SANDBOX_MEMORY=//p' .engines/first/.env) == "${default_memory}g" ]] || fail "the update raised the Company's lower memory limit to the default (${default_memory}g)"
fi
[[ $(docker inspect -f '{{.HostConfig.Memory}}' "$sandbox") == $(( default_memory * 1073741824 )) ]] || fail "the updated sandbox runs with the default memory (${default_memory}g)"
# The Owner signs in, the Company's sign-in still serves, and the Agent still remembers what it was told on $stable.
ENGINE_KEY="$key" compose exec -T -e ENGINE_KEY web node --input-type=module - "$marker" < "$root/scripts/check-install-update.mjs" \
  || fail "the Agent remembers what it was told on $stable and the Company's sign-in still serves"
# Running the install command again keeps the updated install: the same settings, key, Engine and sandbox.
cp .env.install .env.install.before
sh install.sh || fail 'the install command again'
cmp .env.install .env.install.before || fail 'the install command again leaves .env.install as it was'
[[ $(first_engine_key) == "$key" && $(first_engine_id) == "$engine" ]] || fail 'the install command again keeps the Engine'
[[ $(docker ps -q --filter 'name=^gtmworks-sandbox-first$') == "$sandbox" ]] || fail 'the install command again leaves the sandbox running'
echo "release-update: $stable updated to this release"
}

# sandbox-update: an install the release before the work sandbox made, with two Companies, updated to this release (#397,
# ADR 0018). First an update whose migration fails, which leaves that release serving with no sandbox begun, and one whose
# second Company's sandbox does not start after the first Company's was made, which leaves nothing of either (#479); then
# the update itself, after which each Company has its own sandbox, exit and work folder, its Engine is pinned to that sandbox,
# an Agent made before the update runs a command there and still remembers, the Company's level is gone and its past change
# still reads in the log; and the install command again keeps every sandbox and its work folder.
sandbox_update() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
# The release an existing install runs before the work sandbox: a fixed commit of main, the one spec #389's branch last
# merged (#472, before_sandbox_release_commit in scripts/ci-install-lib.sh), with an Engine per Company made by `company
# add` (spec #378), no sandbox, no exit, and Agent levels still stored. Main's own CI already linted and type-checked it,
# so its build skips both.
before_sandbox=$before_sandbox_release_commit
git cat-file -e "$before_sandbox^{commit}" 2> /dev/null || git fetch --no-tags origin "$before_sandbox" || fail 'the release before the work sandbox commit'
git worktree add "$RUNNER_TEMP/sandbox-previous-release" "$before_sandbox" || fail 'the release before the work sandbox checkout'
release_image "$before_sandbox" localhost:5000/gtmworks:0.0.0-engines "$RUNNER_TEMP/sandbox-previous-release" --build-arg NEXT_SKIP_CHECKS=true \
  || fail 'build the release before the work sandbox'
before=$(publish 0.0.0-engines) || fail 'push the release before the work sandbox'
( cd "$RUNNER_TEMP/sandbox-previous-release" && node scripts/release-assets.mjs "$before" "$root/release-before-sandbox" ) || fail 'the release before the work sandbox files'
publish_releases
# This release with the rollback area's failing migration added last: its update applies every migration of this release
# in one transaction, then fails, before any sandbox is begun.
docker build -q -t localhost:5000/gtmworks:0.0.1-failing -f - scripts > /dev/null <<'DOCKERFILE' || fail 'build the release whose update fails'
FROM localhost:5000/gtmworks:0.0.0-ci
COPY --chown=node:node install-failing-migration.sql /app/install/supabase/migrations/99999999999999_failure.sql
DOCKERFILE
failing=$(publish 0.0.1-failing) || fail 'push the release whose update fails'
node scripts/release-assets.mjs "$failing" release-failing "$sandbox" || fail 'the release files whose update fails'
echo "release before the work sandbox: $before; this release: $first; failing: $failing"
dir="$PWD/sandbox-release-install"
mkdir "$dir" && cp release-before-sandbox/docker-compose.install.yml release-before-sandbox/install.sh "$dir/" || fail 'the release before the work sandbox folder'
sh "$dir/install.sh" || fail 'install the release before the work sandbox'
cd "$dir"
sandbox_parts() {
  docker ps -a --format '{{.Names}}' | grep -E '^gtmworks-(sandbox|exit)-'
  docker volume ls -q | grep -E '^gtmworks-(work|sandbox-hostkey)-'
  docker network ls --format '{{.Name}}' | grep -E '^gtmworks-(work|exit)-'
  true
}
[[ -f .engines/first/.env && ! -e .work-sandbox-image && -z $(sandbox_parts) ]] || fail 'that release runs its first Engine from its own folder and makes no sandbox'
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) \
  -e SETUP_CODE="$code" -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" || fail 'first run on the release before the work sandbox'
second_company install.sh || fail "that release's company add makes the second Company"
for attempt in $(seq 1 240); do
  db -F ' ' -c "select c.id,a.profile,e.address from public.companies c join public.hermes_agents a on a.company_id=c.id and a.is_default join public.company_engines e on e.id=c.engine_id order by e.created_at" > engines.txt
  [[ $(grep -c . engines.txt || true) -ge 2 ]] && break
  [[ $attempt == 240 ]] && fail 'two Companies get a main Agent each on their own Engine before the update'
  sleep 1
done
# What each Company's main Agent was told before the update, in its own Engine's profile: the code word
# scripts/check-install-engines.mjs looks for (lib/engine-targets.mjs).
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}
  docker exec "$container" sh -ec 'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' sh "$profile" "backup-${company//-/}" \
    || fail "write a memory in the Engine of $company before the update"
done < engines.txt
# A file each Company's main Agent made before the update, in its profile's old Library root on its Engine's own disk
# (`workspace`, the Library of the release before the work sandbox): the update copies it once into the Agent's own
# folder of its Company's work folder (#397).
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}
  docker exec "$container" sh -ec 'mkdir -p "/opt/data/profiles/$1/workspace"; printf "%s\n" "$2" > "/opt/data/profiles/$1/workspace/$2.md"; chown -R hermes:hermes "/opt/data/profiles/$1/workspace"' sh "$profile" "before-sandbox-${company//-/}" \
    || fail "write a file in the old Library of $company before the update"
done < engines.txt
# The first Company's Owner changes its level through that release's own function, so the log has a level change.
level_company=$(db -c "select id from public.companies where name='Proxy Company'") || fail 'read the first Company'
owner=$(db -c "select person_id from public.members where company_id='$level_company' and role='owner'") || fail "read the first Company's Owner"
db -c "begin; select set_config('request.jwt.claims','{\"sub\":\"$owner\",\"role\":\"authenticated\"}',true); set local role authenticated; select public.set_agent_level('$level_company',2); commit;" > /dev/null \
  || fail 'the Owner changes the Company level on the release before the work sandbox'
level_log() { db -c "select json_build_object('id',id,'subject',subject,'action',action,'details',details)::text from public.company_log where company_id='$level_company' and action='agent_level_changed'"; }
level_before=$(level_log) || fail 'read the level change from the log'
[[ $(grep -c . <<< "$level_before") == 1 ]] || fail 'the level change is in the log before the update'
level_column() { db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='companies' and column_name='agent_level'"; }
: > engines-before
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME)
  id=$(docker inspect -f '{{.Id}}' "$name") || fail "read the Engine $name"
  echo "$name $id" >> engines-before
done
[[ $(grep -c . engines-before) == 2 ]] || fail 'the release before the work sandbox runs an Engine for each Company'
# A failed update: its migration fails, the release it runs keeps serving, and nothing of a sandbox is begun: no
# container, volume or network, no key in an Engine's volume, and no image recorded.
web=$(compose ps -q web)
# The previous release's own Engine files, as its install left them.
engine_files_before=$(cd scripts && cksum engine-*) || fail "read the previous release's Engine files"
cp "$root/release-failing/docker-compose.install.yml" "$root/release-failing/install.sh" . || fail 'the release files whose update fails in place'
if sh install.sh update > update.log 2>&1; then fail_update 'the update whose migration fails must fail'; fi
grep -Fq 'Applying migration: 99999999999999_failure.sql' update.log || fail_update 'the failed update names its migration'
[[ $(compose ps -q web) == "$web" ]] || fail_update 'the failed update leaves the release before the work sandbox serving'
probe 'after the failed update'
[[ $(db -c "select to_regclass('public.update_should_rollback') is null") == t ]] || fail_update 'the failed migration rolled back'
[[ $(level_column) == 1 ]] || fail_update "the failed update leaves the Company level that release reads"
while read -r name id; do
  [[ $(docker inspect -f '{{.Id}}' "$name") == "$id" ]] || fail_update "the failed update leaves the Engine $name running"
  if docker exec -u 0 "$name" test -e /opt/data/ssh; then fail_update "the failed update made no sandbox key in the Engine $name"; fi
done < engines-before
half=$(sandbox_parts)
[[ -z $half ]] || fail_update "the failed update leaves no half-made sandbox: $half"
[[ ! -e .work-sandbox-image ]] || fail_update 'the failed update records no work sandbox image'
# Its Engine files on disk are the previous release's own again (#554), as that release's company add, restore and the
# next update's rollback read them.
previous_engine_files() { [[ $(cd scripts && cksum engine-*) == "$engine_files_before" ]]; }
previous_engine_files || fail_update "the failed update leaves the previous release's own Engine files"
# An update whose work sandbox image cannot be pulled (#397): the image is pulled before the migrations, so the update
# exits non-zero with no migration applied and the release it runs keeps serving.
applied=$(db -c 'select count(*) from gtmworks_install.schema_migrations') || fail 'read the applied migrations'
unpulled="localhost:5000/gtmworks-sandbox@sha256:$(printf '%064d' 0)"
( cd "$root" && node scripts/release-assets.mjs "$first" release-no-sandbox "$unpulled" ) || fail 'the release files whose sandbox image cannot be pulled'
cp "$root/release-no-sandbox/docker-compose.install.yml" "$root/release-no-sandbox/install.sh" . || fail 'the release files whose sandbox image cannot be pulled in place'
if sh install.sh update > update.log 2>&1; then fail_update 'the update whose sandbox image cannot be pulled must fail'; fi
grep -Fq "Pulling the work sandbox image: $unpulled" update.log || fail_update 'the update tries to pull the sandbox image'
if grep -Fq 'Applying migration:' update.log; then fail_update 'the update whose sandbox image cannot be pulled applies no migration'; fi
[[ $(db -c 'select count(*) from gtmworks_install.schema_migrations') == "$applied" && $(level_column) == 1 ]] || fail_update 'the update whose sandbox image cannot be pulled leaves the schema as it was'
[[ $(compose ps -q web) == "$web" ]] || fail_update 'the update whose sandbox image cannot be pulled leaves the release before the work sandbox serving'
probe 'after the update whose sandbox image cannot be pulled'
[[ -z $(sandbox_parts) && ! -e .work-sandbox-image ]] || fail_update 'the update whose sandbox image cannot be pulled begins no sandbox'
previous_engine_files || fail_update "the update whose sandbox image cannot be pulled leaves the previous release's own Engine files"
# An update whose second Company's sandbox does not start, after its migrations applied and the first Company's sandbox,
# exit, work folder and networks were made (#479): its Company is given more CPUs than Docker has, which Docker refuses at
# the sandbox's start. The previous release keeps serving with its own Engines, and nothing of a sandbox is left: no
# container, volume or network of either Company, no key in an Engine's volume, and no image recorded.
second_slug=$(ls .engines | grep -vx first)
[[ -n $second_slug && $second_slug != *$'\n'* ]] || fail "read the second Company's one Engine folder"
printf 'SANDBOX_CPUS=100000\n' >> ".engines/$second_slug/.env"
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place for the failed sandbox start'
if GTMWORKS_ENGINE_WAIT=60 sh install.sh update > update.log 2>&1; then fail_update "the update whose second Company's sandbox does not start must fail"; fi
grep -Fq 'Applying migration:' update.log || fail_update "the update whose second Company's sandbox does not start applies its migrations first"
grep -Fq 'the previous release keeps serving, with its own Engines again' update.log || fail_update "the update whose second Company's sandbox does not start says the previous release keeps serving"
if grep -Fq 'could not all be removed' update.log; then fail_update "the update whose second Company's sandbox does not start removes what it made"; fi
[[ $(compose ps -q web) == "$web" ]] || fail_update "the update whose second Company's sandbox does not start leaves the release before the work sandbox serving"
probe "after the update whose second Company's sandbox does not start"
[[ $(level_column) == 1 ]] || fail_update "the update whose second Company's sandbox does not start leaves the Company level that release reads"
while read -r name id; do
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name") == healthy ]] || fail_update "the Engine $name is healthy again after the failed sandbox start"
  [[ $(docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' "$name" | grep -c .) == 1 ]] || fail_update "the Engine $name is back on its own network only"
  if docker exec -u 0 "$name" test -e /opt/data/ssh; then fail_update "the failed sandbox start leaves no sandbox key in the Engine $name"; fi
done < engines-before
half=$(sandbox_parts)
[[ -z $half ]] || fail_update "the failed sandbox start leaves no half-made sandbox: $half"
[[ ! -e .work-sandbox-image ]] || fail_update 'the failed sandbox start records no work sandbox image'
sed -i '/^SANDBOX_CPUS=/d' ".engines/$second_slug/.env"
# The update to this release: each Company gets its own sandbox, exit and work folder, and its Engine, recreated on its own
# volume, is pinned to that sandbox.
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
sh install.sh update || fail 'the update of the release before the work sandbox'
[[ $(cat .install-release) == "$first" ]] || fail 'the update records this release'
: > sandboxes-before
while read -r name id; do
  slug=${name#gtmworks-engine-}
  engine=$(docker ps -q --filter "name=^${name}$")
  [[ -n $engine ]] || fail "the updated install runs the Engine $name"
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Name}}{{end}}{{end}}' "$engine") == "$(engine_value ".engines/$slug" VOLUME)" ]] || fail "the Engine $name keeps its own volume"
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/hermes/config.yaml"}}{{.RW}}{{end}}{{end}}' "$engine") == false ]] \
    && docker exec "$engine" grep -qx '  backend: ssh' /etc/hermes/config.yaml && docker exec "$engine" grep -qx '  ssh_sync_files: false' /etc/hermes/config.yaml \
    || fail "the Engine $name is pinned to its sandbox, with no file sync"
  [[ $(docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' "$engine" | grep . | sort) == $(printf '%s\n' "$(engine_value ".engines/$slug" NETWORK)" "gtmworks-work-$slug" | sort) ]] \
    || fail "the Engine $name joins its own network and its work network only"
  for part in sandbox exit; do
    container=$(docker ps -q --filter "name=^gtmworks-$part-$slug$")
    [[ -n $container && $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container") == healthy ]] || fail "the update starts the $part of $name, healthy"
    [[ $(docker inspect -f '{{.Config.Image}}' "$container") == "$(cat .work-sandbox-image)" ]] || fail "the $part of $name runs the image the install recorded"
  done
  box=$(docker ps -q --filter "name=^gtmworks-sandbox-$slug$")
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Name}}{{end}}{{end}}' "$box") == "gtmworks-work-$slug" ]] || fail "the sandbox of $name works in its Company's own work folder"
  echo "$slug $box" >> sandboxes-before
done < engines-before
[[ $(cut -d' ' -f2 sandboxes-before | sort -u | grep -c .) == 2 ]] || fail 'each Company has its own sandbox'
# Each Company's main Agent, made before the update, runs a command in its own Company's sandbox and still remembers what
# its own Engine was told; the job reads each sandbox for the file, and no other Company's sandbox has it.
sandbox_marker="sandbox-update-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
compose exec -T web node --input-type=module - sandbox "$sandbox_marker" < "$root/scripts/check-install-engines.mjs" > sandbox-update.log 2>&1 \
  || { cat sandbox-update.log; fail "an Agent made before the update runs a command in its Company's sandbox and still remembers"; }
cat sandbox-update.log
db -F ' ' -c 'select c.id,e.address from public.companies c join public.company_engines e on e.id=c.engine_id' > companies.txt || fail "read each Company's Engine"
[[ $(grep -c . companies.txt) == 2 ]] || fail 'the updated install has its two Companies'
while read -r company address; do
  slug=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
  file="$sandbox_marker-${company//-/}"
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$file.txt") == "$file" ]] || fail "the Agent of $company ran its command in its own Company's sandbox"
  host=$(grep -F "\"file\":\"$file\"" sandbox-update.log | sed -n 's/.*"sandbox_host":"\([^"]*\)".*/\1/p')
  [[ -n $host && $host == "$(docker exec "gtmworks-sandbox-$slug" hostname)" ]] || fail "the command of $company's Agent ran in its sandbox"
  while read -r other _; do
    [[ $other == "$slug" ]] && continue
    if docker exec "gtmworks-sandbox-$other" test -e "/work/$file.txt"; then fail "the file of $company's Agent is in no other Company's sandbox"; fi
  done < sandboxes-before
done < companies.txt
# The file each main Agent made before the update is in its own folder of its Company's work folder, listed in its
# Library, while the original stays on the Engine and no other Company's work folder has it.
# `compose exec` reads its stdin, so each one inside this loop reads /dev/null: it would take the rest of engines.txt
# and end the loop after the first Company.
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}; slug=${container#gtmworks-engine-}; file="before-sandbox-${company//-/}"
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$profile/$file.md") == "$file" ]] || fail "the update copies the old Library file of $company into its Agent's folder"
  [[ $(docker exec "$container" cat "/opt/data/profiles/$profile/workspace/$file.md") == "$file" ]] || fail "the update leaves the old Library file of $company on its Engine"
  compose exec -T web node --input-type=module -e "const {engineOf}=await import('/app/lib/company-engine.mjs'); const {listAgentFiles}=await import('/app/lib/engine/files.mjs'); const read=await listAgentFiles({...await engineOf('$company'),profile:'$profile'}); console.log(read.state, (read.entries||[]).map(entry=>entry.name).join(' '));" < /dev/null \
    | grep -qE "^found (.* )?$file\.md( |\$)" || fail "the Library of $company's Agent lists the file it made before the update"
  while read -r other _; do
    [[ $other == "$slug" ]] && continue
    if docker exec "gtmworks-sandbox-$other" test -e "/work/$profile/$file.md"; then fail "the old Library file of $company is in no other Company's work folder"; fi
  done < sandboxes-before
  # Changed in the work folder after the update: running the install command again leaves it as it is.
  docker exec -u pn "gtmworks-sandbox-$slug" sh -ec 'printf changed > "$1"' sh "/work/$profile/$file.md" || fail "change the copied file of $company"
done < engines.txt
# The Company's level is gone, and its past change is still in the log as it was and reads by the level's names.
[[ $(level_column) == 0 ]] || fail 'the update removes the Company level'
[[ $(level_log) == "$level_before" ]] || fail 'the past level change stays in the log as it was'
compose exec -T -e LEVEL_ROW="$level_before" web node --input-type=module -e "const {describeEntry}=await import('/app/lib/activity-log.mjs'); const read=describeEntry(JSON.parse(process.env.LEVEL_ROW)); console.log(JSON.stringify([read.act,read.from,read.to]));" \
  | grep -qxF '[["logActAgentLevel"],{"key":"agentLevel1"},{"key":"agentLevel2"}]' || fail 'the past level change still reads in the log'
# Running the install command again keeps every sandbox and its work folder.
sh install.sh || fail 'the install command again on the updated install'
while read -r slug box; do
  [[ $(docker ps -q --filter "name=^gtmworks-sandbox-$slug$") == "$box" ]] || fail "the install command again keeps the sandbox of $slug"
done < sandboxes-before
while read -r company address; do
  slug=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$sandbox_marker-${company//-/}.txt") == "$sandbox_marker-${company//-/}" ]] || fail "the install command again keeps the work folder of $slug"
done < companies.txt
while read -r company profile address; do
  slug=${address#http://gtmworks-engine-}; slug=${slug%%:*}
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$profile/before-sandbox-${company//-/}.md") == changed ]] || fail "the install command again copies no old Library file over the changed one of $company"
done < engines.txt
}

# engines-update: an install this release made, with two Companies after `company add`, updates to a release that pins
# another Engine image: every Company's Engine is recreated from the new template with its own volume, key and network,
# and a Run on each answers afterwards (#386, ADR 0018). Its own area since the work sandbox image (#389) took the update
# area past its 12 minutes; it starts from this release's own files, not from the update area's install.
engines_update() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
publish_releases
hermes_image=$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)
# The update wrote these files as the install's user from a container; a root container removes them on any Docker.
docker run --rm -v "$PWD:/work" alpine:3.21 rm -rf /work/release-install || fail 'remove the first release install folder'
mkdir release-install
cp release-first/docker-compose.install.yml release-first/install.sh release-install/ || fail 'the first release files again'
cd release-install
sh install.sh || fail 'install a release with two Companies'
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) \
  -e SETUP_CODE="$code" -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" || fail 'first run before company add'
second_company install.sh || fail 'company add before the update'
for attempt in $(seq 1 240); do
  db -F ' ' -c "select c.id,a.profile,e.address from public.companies c join public.hermes_agents a on a.company_id=c.id and a.is_default join public.company_engines e on e.id=c.engine_id order by e.created_at" > engines.txt
  [[ $(grep -c . engines.txt || true) -ge 2 ]] && break
  [[ $attempt == 240 ]] && fail 'two Companies get a main Agent each on their own Engine'
  sleep 1
done
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}
  code="backup-${company//-/}"
  docker exec "$container" sh -ec 'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' sh "$profile" "$code" \
    || fail "write a memory in the Engine of $company"
done < engines.txt
: > engines-before
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME)
  echo "$name $(docker inspect -f '{{.Id}} {{.Config.Image}}' "$name")" >> engines-before
done
# Each Company's sandbox and a file in its work folder before the update (#399): the release also pins another work
# sandbox image, so every sandbox is made again from it, and the work folder stays.
: > sandboxes-before
update_marker="update-work-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME); slug=${name#gtmworks-engine-}
  docker exec "gtmworks-sandbox-$slug" sh -ec 'printf "%s" "$1" > "/work/$1.txt"' sh "$update_marker-$slug" || fail "write in the work folder of $name"
  echo "$slug $(docker inspect -f '{{.Id}}' "gtmworks-sandbox-$slug")" >> sandboxes-before
done
# The release pins another Engine image: the pinned image under another tag, so the update runs the same Hermes without
# another pull.
docker tag "$hermes_image" gtmworks-engine-check:0.0.2 || fail 'tag the other Engine image'
docker build -q -t localhost:5000/gtmworks:0.0.2-ci - > /dev/null <<'DOCKERFILE' || fail 'build the release that pins another Engine image'
FROM localhost:5000/gtmworks:0.0.1-ci
RUN sed -i '0,/^\( *image:\).*/s//\1 gtmworks-engine-check:0.0.2/' /app/install/scripts/engine-template.yml
DOCKERFILE
fourth=$(publish 0.0.2-ci) || fail 'push the release that pins another Engine image'
# Another work sandbox image too: the same tools under one more label, so its digest is another one and nothing is pulled
# from outside the machine.
docker build -q -t localhost:5000/gtmworks-sandbox:0.0.2-ci - > /dev/null <<DOCKERFILE || fail 'build another work sandbox image'
FROM $sandbox
LABEL org.gtmworks.check=0.0.2
DOCKERFILE
other_sandbox=$(publish_sandbox 0.0.2-ci) || fail 'push another work sandbox image'
[[ $other_sandbox != "$sandbox" ]] || fail 'the other work sandbox image has its own digest'
( cd "$root" && node scripts/release-assets.mjs "$fourth" release-engines "$other_sandbox" ) || fail 'the release files that pin another Engine image'
cp "$root/release-engines/docker-compose.install.yml" "$root/release-engines/install.sh" . || fail 'the release files that pin another Engine image in place'
sh install.sh update || fail 'update every Company Engine'
[[ $(cat .install-release) == "$fourth" ]] || fail 'the update records the release that pins another Engine image'
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME)
  volume=$(engine_value "$folder" VOLUME)
  network=$(engine_value "$folder" NETWORK)
  before=$(grep "^$name " engines-before | cut -d' ' -f2)
  engine=$(docker ps -q --filter "name=^${name}$")
  [[ -n $engine && $(docker inspect -f '{{.Id}}' "$engine") != "$before" ]] || fail "the update recreated the Engine $name"
  [[ $(docker inspect -f '{{.Config.Image}}' "$engine") == gtmworks-engine-check:0.0.2 ]] || fail "the Engine $name runs the image the release pins"
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Name}}{{end}}{{end}}' "$engine") == "$volume" ]] || fail "the Engine $name keeps its own volume through the update"
  [[ $(docker inspect -f '{{range $other, $_ := .NetworkSettings.Networks}}{{println $other}}{{end}}' "$engine" | grep . | sort) == $(printf '%s\n' "$network" "gtmworks-work-${name#gtmworks-engine-}" | sort) ]] || fail "the Engine $name joins its own network and its work network only after the update"
done
# Every sandbox was made again from the work sandbox image the release pins, and its work folder kept what it held (#399).
[[ $(cat .work-sandbox-image) == "$other_sandbox" ]] || fail 'the update records the work sandbox image the release pins'
while read -r slug before; do
  sandbox_id=$(docker ps -q --no-trunc --filter "name=^gtmworks-sandbox-$slug$")
  [[ -n $sandbox_id && $sandbox_id != "$before" ]] || fail "the update made the sandbox of $slug again"
  [[ $(docker inspect -f '{{.Config.Image}}' "gtmworks-sandbox-$slug") == "$other_sandbox" ]] || fail "the sandbox of $slug runs the work sandbox image the release pins"
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "gtmworks-sandbox-$slug") == healthy ]] || fail "the remade sandbox of $slug is healthy"
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$update_marker-$slug.txt") == "$update_marker-$slug" ]] || fail "the update keeps the work folder of $slug"
done < sandboxes-before
# A Run on each Company answers on its own Engine, the code word its own Engine kept reaches its own Run only, and its
# Agent runs a command in the remade sandbox.
compose exec -T web node --input-type=module - sandbox "$update_marker" < "$root/scripts/check-install-engines.mjs" > engines-update.log 2>&1 \
  || { cat engines-update.log; fail 'a Run on each Company answers after the update, and its Agent runs a command in its sandbox'; }
cat engines-update.log
}

# one-line: the one line (#51) and `gtmworks update` (#52) against test releases served the way GitHub Releases serves
# them: the install, its repair, its update, a refused older release, a failed update, going back, and a second folder
# refused.
one_line() {
cd "$root"
area_setup
fail_prefix='one-line install check failed: '
set -o pipefail
workspace=$PWD
# The area makes everything it needs itself (#406): the app image the test releases are made from, a local registry,
# and the two releases' files. CI loads the one image the `image` job built and tags it (GTMWORKS_IMAGE_PREBUILT, tests
# only); on a fresh Docker machine anywhere else a source install builds it first.
reset_install
if [[ ${GTMWORKS_IMAGE_PREBUILT:-} != true ]] && ! docker image inspect "$(web_image_tag)" > /dev/null 2>&1; then
  install_source source-install.log || fail 'source install for the test releases'
  reset_install
fi
start_registry
publish_releases
releases="$workspace/test-releases"
mkdir -p "$releases/v0.0.0" "$releases/v0.0.1" "$releases/v0.0.2"
cp release-first/docker-compose.install.yml release-first/install.sh "$releases/v0.0.0/" || fail 'test release v0.0.0'
echo '[{"tag_name":"v0.0.0"}]' > "$releases/releases.json"
export GTMWORKS_RELEASES="file://$releases" GTMWORKS_GET="file://$workspace/scripts/get.sh"
export HOME="$workspace/one-line-home"
mkdir "$HOME"
dir="$HOME/gtmworks"
first=$(sed -n 's/^release_image=//p' release-first/install.sh)
next=$(sed -n 's/^release_image=//p' release-next/install.sh)
sandbox=$(sed -n 's/^sandbox_image=//p' release-first/install.sh)
line() { curl -fsSL "$GTMWORKS_GET" | sh -s -- "$@"; }
# The one line in an empty folder installs the latest release (v0.0.0 while it is the only one).
{ line || fail 'the one line in an empty folder'; } 2>&1 | tee one-line.log
grep -Fx 'Installing gtmworks v0.0.0 into '"$dir"'.' one-line.log || fail 'the line installs the latest release'
grep -E 'Digest: sha256:[a-f0-9]{64}' one-line.log || fail 'the log shows the image pulled by digest'
if grep -Ei 'compose build|\[\+\] Building' one-line.log; then fail 'the one line builds nothing'; fi
grep -Fx 'http://gateway:8080/api/health 200' one-line.log || fail 'the install health probe returns 200'
cd "$dir"
probe 'after the one line'
checksum=$(sha256sum < .env.install)
echo ".env.install sha256 after the first run: $checksum"
db -c "with e as (insert into public.company_engines (id,address,key_encrypted) values ('00000000-0000-4000-8000-000000000234','http://gtmworks-engine-first:8642','one-line-probe') returning id) insert into public.companies (id,slug,name,engine_id) select '00000000-0000-4000-8000-000000000238','one-line-probe','Kept by the line',id from e;" || fail 'insert the probe'
migrations > "$RUNNER_TEMP/one-line-migrations" || fail 'read the migrations'
# The line again, and once naming the version: each repairs and restarts the same release, keeping keys and data.
for run in again version; do
  cd "$workspace"
  if [[ $run == again ]]; then args=(); else args=(--version v0.0.0); fi
  { line "${args[@]}" || fail "the one line ($run)"; } 2>&1 | tee "one-line-$run.log"
  grep -Fx "Repairing gtmworks v0.0.0 in $dir; its keys and data are kept." "one-line-$run.log" || fail "the line repairs ($run)"
  grep -Fx "gtmworks v0.0.0: $first" "one-line-$run.log" || fail "the log names the release ($run)"
  cd "$dir"
  echo ".env.install sha256 after the line ($run): $(sha256sum < .env.install)"
  [[ $(sha256sum < .env.install) == "$checksum" ]] || fail ".env.install unchanged ($run)"
  [[ $(db -c "select name from public.companies where slug='one-line-probe'") == 'Kept by the line' ]] || fail "test data kept ($run)"
  migrations | diff -u "$RUNNER_TEMP/one-line-migrations" - || fail "migrations unchanged ($run)"
done
# gtmworks from a new login shell: the line put ~/.local/bin on the PATH through the shell profile.
grep -F 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.profile" || fail 'the profile puts ~/.local/bin on the PATH'
env -i HOME="$HOME" PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_HOST="$DOCKER_HOST" \
  sh -lc 'command -v gtmworks && gtmworks status' 2>&1 | tee "$RUNNER_TEMP/status.log" || fail 'gtmworks status from a new shell'
services=$(compose config --services) || fail 'read the install services'
[[ -n $services ]] || fail 'the install names its services'
for service in $services; do
  grep -E "^$service +healthy" "$RUNNER_TEMP/status.log" || fail "gtmworks status reports $service healthy"
done
grep -Ex 'All [0-9]+ services are healthy\.' "$RUNNER_TEMP/status.log" || fail 'gtmworks status reports every service healthy'
grep -Ex 'Engine http://gtmworks-engine-first:8642: healthy \(waiting for a Company\)' "$RUNNER_TEMP/status.log" || fail 'gtmworks status reports every Engine'
grep -Ex 'Sandbox gtmworks-sandbox-first: running( \(Company "[^"]*"\))?' "$RUNNER_TEMP/status.log" || fail 'gtmworks status reports the work sandbox'
export PATH="$HOME/.local/bin:$PATH"
# v0.0.1 is published: gtmworks update moves to it, backing up first.
cp "$workspace/release-next/docker-compose.install.yml" "$workspace/release-next/install.sh" "$releases/v0.0.1/" || fail 'test release v0.0.1'
echo '[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"}]' > "$releases/releases.json"
# #437: the install keeps an older gtmworks command, one from before #437 (main's, bbd2941a) without sign-in: it never
# replaced itself, so the update leaves the one v0.0.1 carries through v0.0.1's install.sh.
older_command=bbd2941a5c8064f496dc29a83c7e8fe251e96e5f
git -C "$workspace" cat-file -e "$older_command^{commit}" 2> /dev/null || git -C "$workspace" fetch -q --no-tags --depth 1 origin "$older_command" || fail 'the older gtmworks command commit'
git -C "$workspace" show "$older_command:scripts/get.sh" | sed '/^ *elif \[ "$operation" = sign-in \]/d' > gtmworks.sh.older && mv gtmworks.sh.older gtmworks.sh || fail 'swap in an older gtmworks command'
if gtmworks sign-in claude > "$RUNNER_TEMP/older-command.log" 2>&1; then fail 'the older command must refuse sign-in'; fi
grep -Fx 'Unexpected argument: claude' "$RUNNER_TEMP/older-command.log" || fail 'the older command knows no sign-in'
old_image=$(web_image)
{ gtmworks update || fail 'gtmworks update'; } 2>&1 | tee "$RUNNER_TEMP/update.log"
if gtmworks sign-in claude > "$RUNNER_TEMP/updated-command.log" 2>&1; then fail 'sign-in without --company must stop at its usage'; fi
grep -Fx 'gtmworks sign-in claude needs --company <id-or-name>.' "$RUNNER_TEMP/updated-command.log" || fail 'after the update, the gtmworks command runs sign-in'
archive=$(sed -n 's/^Backup: //p' "$RUNNER_TEMP/update.log" | tail -n 1)
[[ $archive == "$dir"/backups/*.tgz && -f $archive ]] || fail 'the update prints the backup archive path'
grep -E 'Digest: sha256:[a-f0-9]{64}' "$RUNNER_TEMP/update.log" || fail 'the update pulls the new image by digest'
grep -Fx "gtmworks v0.0.1 is running: $next" "$RUNNER_TEMP/update.log" || fail 'the update names the new image digest'
grep -Fx "To go back to v0.0.0: gtmworks restore '$archive' --version v0.0.0" "$RUNNER_TEMP/update.log" || fail 'the update prints the command to go back'
[[ $(cat .install-release) == "$next" && $(cat .gtmworks-version) == v0.0.1 && $(web_image) != "$old_image" ]] || fail 'the update runs v0.0.1'
[[ $(db -c "select to_regclass('gtmworks_install.release_update_probe') is not null") == t ]] || fail 'the v0.0.1 migration applied'
probe 'after gtmworks update'
echo "find $dir ! -user $(id -u):"
owners=$(owned_by_others "$dir")
[[ -z $owners ]] || { echo "$owners"; fail 'every file in the install folder belongs to the user who ran the update'; }
# An older release than the data: refused, nothing changed.
migrations > "$RUNNER_TEMP/updated-migrations"
image=$(web_image)
if gtmworks update --version v0.0.0 > "$RUNNER_TEMP/refused.log" 2>&1; then cat "$RUNNER_TEMP/refused.log"; fail 'an update to an older release must be refused'; fi
cat "$RUNNER_TEMP/refused.log"
grep -F 'older than the data' "$RUNNER_TEMP/refused.log" && grep -F 'Nothing was changed.' "$RUNNER_TEMP/refused.log" || fail 'the refusal says why in plain words'
[[ $(web_image) == "$image" && $(cat .install-release) == "$next" && $(cat .gtmworks-version) == v0.0.1 ]] || fail 'the refused update left the running release'
migrations | diff -u "$RUNNER_TEMP/updated-migrations" - || fail 'the refused update left the migrations'
# A failing migration on the update path: rolled back, the previous release serves on its own files, non-zero exit.
docker build -q -t localhost:5000/gtmworks:0.0.2-ci - > /dev/null <<'DOCKERFILE' || fail 'build the failing release image'
FROM localhost:5000/gtmworks:0.0.1-ci
RUN printf '%s\n' 'create table public.update_should_rollback(value integer);' 'select 1 / 0;' > /app/install/supabase/migrations/99999999999999_failure.sql
DOCKERFILE
failing=$(publish 0.0.2-ci) || fail 'push the failing release image'
(cd "$workspace" && node scripts/release-assets.mjs "$failing" "$releases/v0.0.2" "$sandbox") || fail 'failing release files'
old_web=$(compose ps -q web)
if gtmworks update --version v0.0.2 --no-backup > "$RUNNER_TEMP/failed-update.log" 2>&1; then cat "$RUNNER_TEMP/failed-update.log"; fail 'the failing update must exit non-zero'; fi
cat "$RUNNER_TEMP/failed-update.log"
grep -Fq 'Applying migration: 99999999999999_failure.sql' "$RUNNER_TEMP/failed-update.log" || fail 'the failed update names its migration'
[[ $(compose ps -q web) == "$old_web" ]] || fail 'the previous web container still serves'
[[ $(db -c "select to_regclass('public.update_should_rollback') is null") == t ]] || fail 'the failed migration rolled back'
[[ $(cat .install-release) == "$next" && $(cat .gtmworks-version) == v0.0.1 ]] || fail 'the previous release files are back'
probe 'after the failed update'
owners=$(owned_by_others "$dir")
[[ -z $owners ]] || { echo "$owners"; fail 'every file still belongs to the user after the failed update'; }
# The printed command goes back to v0.0.0 with the data from before the update; with no terminal to ask on, it
# replaces the current data only with --yes.
back=$(sed -n 's/^To go back to v0\.0\.0: //p' "$RUNNER_TEMP/update.log")
[[ -n $back ]] || fail 'the update printed the command to go back'
if eval "$back" < /dev/null > "$RUNNER_TEMP/go-back-unasked.log" 2>&1; then cat "$RUNNER_TEMP/go-back-unasked.log"; fail 'going back without --yes must ask first'; fi
grep -F 'Run it again with --yes to go on. Nothing was changed.' "$RUNNER_TEMP/go-back-unasked.log" || fail 'going back without --yes says how to go on'
[[ $(cat .install-release) == "$next" ]] || fail 'going back without --yes changed nothing'
{ eval "$back --yes" || fail 'the printed command goes back'; } 2>&1 | tee "$RUNNER_TEMP/go-back.log"
[[ $(cat .install-release) == "$first" && $(cat .gtmworks-version) == v0.0.0 ]] || fail 'back on v0.0.0'
migrations | diff -u "$RUNNER_TEMP/one-line-migrations" - || fail 'the migrations of v0.0.0 again'
[[ $(db -c "select name from public.companies where slug='one-line-probe'") == 'Kept by the line' ]] || fail 'the data from before the update'
[[ $(sha256sum < .env.install) == "$checksum" ]] || fail 'the keys from before the update'
probe 'after going back'
gtmworks status || fail 'healthy after going back'
owners=$(owned_by_others "$dir")
[[ -z $owners ]] || { echo "$owners"; fail 'every file belongs to the user after going back'; }
# One machine runs one install: the line refuses a second folder while this one runs, before changing anything.
fresh="$workspace/one-line-fresh"
cd "$workspace"
if line --dir "$fresh" > "$RUNNER_TEMP/second-dir.log" 2>&1; then cat "$RUNNER_TEMP/second-dir.log"; fail 'a second install folder must be refused'; fi
cat "$RUNNER_TEMP/second-dir.log"
grep -F "gtmworks already runs from $dir on this machine" "$RUNNER_TEMP/second-dir.log" || fail 'the refusal names the folder that runs gtmworks'
[[ ! -e $fresh ]] || fail 'the refused second folder was not created'
(cd "$dir" && [[ $(cat .install-release) == "$first" ]] && compose ps --status running -q web | grep -q .) || fail 'the first install still runs after the refusal'
# --version installs that release and not the latest: v0.0.0 into a fresh folder while v0.0.1 is the latest.
(cd "$dir" && compose down -v) || fail 'remove the one-line install'
remove_engine
echo '[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"}]' > "$releases/releases.json"
{ line --version v0.0.0 --dir "$fresh" || fail 'the one line with --version'; } 2>&1 | tee "$RUNNER_TEMP/one-line-version.log"
grep -Fx "Installing gtmworks v0.0.0 into $fresh." "$RUNNER_TEMP/one-line-version.log" || fail 'the --version run names v0.0.0'
grep -Fx "gtmworks v0.0.0: $first" "$RUNNER_TEMP/one-line-version.log" || fail 'the --version run names the v0.0.0 image'
cd "$fresh"
[[ $(cat .install-release) == "$first" && $(cat .gtmworks-version) == v0.0.0 ]] || fail 'the --version run records v0.0.0'
[[ $(web_image) == $(docker image inspect -f '{{.Id}}' "$first") ]] || fail 'the running web container is the v0.0.0 image'
probe 'after the --version run'
}

# updater: Update now and automatic updates (#443, ADR 0020) on a real install of the test releases: the line puts the
# updater in cron, the first run's Owner asks for an update, and one run of the updater installs the newest release and
# records it; with the button off a request is refused and one already recorded is ignored; a release whose app never
# comes up healthy, after its migration ran, is rolled back from the update's own backup and the failure is shown; and
# with automatic updates on the updater installs the newest release without a click. The machine's own systemd and cron
# are never touched: the schedulers on the PATH here keep their table in a file.
updater() {
cd "$root"
area_setup
fail_prefix='updater install check failed: '
set -o pipefail
workspace=$PWD
dir="$workspace/updater-home/gtmworks"
# The install lives in its own folder here, so the summary reads that install with the checkout's script.
trap 'status=$?; if [ "$status" -ne 0 ]; then (cd "$dir" 2> /dev/null && bash "$workspace/scripts/install-diagnostics.sh") || true; fi; exit "$status"' EXIT
reset_install
if [[ ${GTMWORKS_IMAGE_PREBUILT:-} != true ]] && ! docker image inspect "$(web_image_tag)" > /dev/null 2>&1; then
  install_source source-install.log || fail 'source install for the test releases'
  reset_install
fi
start_registry
publish_releases
releases="$workspace/test-releases"
mkdir -p "$releases/v0.0.0" "$releases/v0.0.1"
cp release-first/docker-compose.install.yml release-first/install.sh "$releases/v0.0.0/" || fail 'test release v0.0.0'
cp release-next/docker-compose.install.yml release-next/install.sh "$releases/v0.0.1/" || fail 'test release v0.0.1'
echo '[{"tag_name":"v0.0.0"}]' > "$releases/releases.json"
export GTMWORKS_RELEASES="file://$releases" GTMWORKS_GET="file://$workspace/scripts/get.sh"
export HOME="$workspace/updater-home" CRONTAB_FILE="$workspace/updater-crontab"
mkdir -p "$HOME" "$workspace/updater-bin"
printf '%s\n' '#!/bin/sh' 'exit 1' > "$workspace/updater-bin/systemctl"
printf '%s\n' '#!/bin/sh' 'case "$1" in -l) cat "$CRONTAB_FILE" 2> /dev/null;; -) cat > "$CRONTAB_FILE";; *) exit 2;; esac' > "$workspace/updater-bin/crontab"
chmod 755 "$workspace/updater-bin/systemctl" "$workspace/updater-bin/crontab"
export PATH="$workspace/updater-bin:$HOME/.local/bin:$PATH"
next=$(sed -n 's/^release_image=//p' release-next/install.sh)
{ curl -fsSL "$GTMWORKS_GET" | sh -s -- --version v0.0.0 || fail 'the one line installs v0.0.0'; } 2>&1 | tee updater-install.log
grep -F "'$HOME/.local/bin/gtmworks' updater > /dev/null 2>&1 # gtmworks updater" "$CRONTAB_FILE" || fail 'the line puts the updater in cron'
cd "$dir"
# First run as complete_setup makes it, read from the checkout: this area stands in the install folder.
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SETUP_CODE)=' .env.install) \
  -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$workspace/scripts/check-install-proxy.mjs" || fail 'first run makes the Owner who asks for the update'
owner() {
  docker run --rm -i --network host --env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install) \
    node:22.14.0-alpine3.21 node --input-type=module - "$1" < "$workspace/scripts/check-install-update-request.mjs"
}
state() { db -c "select state||' '||coalesce(version,'') from public.install_updates"; }
gtmworks status | tee "$RUNNER_TEMP/updater-status.log" || fail 'gtmworks status before the update'
grep -Fx 'Update now button: on. Automatic updates: off.' "$RUNNER_TEMP/updater-status.log" || fail 'status shows the button on and automatic updates off'
grep -Fx 'Updater: cron, every minute' "$RUNNER_TEMP/updater-status.log" || fail 'status names the updater'
# v0.0.1 is out: the Owner clicks Update now, and one run of the updater installs it, as the timer would.
echo '[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"}]' > "$releases/releases.json"
[[ $(owner request) == requested ]] || fail "the Owner's request is recorded"
# The cron line itself runs it, as cron's shell would (its `\%` read back as `%`), not a command typed here.
cron_command=$(grep -F '# gtmworks updater' "$CRONTAB_FILE" | sed -E 's/^([^ ]+ ){5}//; s/\\%/%/g')
sh -c "$cron_command" || { cat .gtmworks-updater.log; fail 'the cron line runs the updater, which runs the update'; }
[[ $(cat .install-release) == "$next" && $(cat .gtmworks-version) == v0.0.1 ]] || fail 'the updater installed the newest release of the channel'
[[ $(state) == 'updated v0.0.1' ]] || fail 'the updater records the version it installed'
[[ $(owner read) == 'updated v0.0.1 button-on' ]] || fail 'the Owner reads Updated to v0.0.1'
probe 'after the updater'
gtmworks status || fail 'healthy after the updater'
# The button off: the Owner is refused, and a request recorded before is ignored by the updater.
gtmworks update-button off || fail 'gtmworks update-button off'
[[ $(owner refused) == refused ]] || fail 'with the button off the request is refused'
db -c "update public.install_updates set state='requested'" > /dev/null || fail 'a request recorded before the button went off'
gtmworks updater || fail 'the updater with the button off'
[[ $(state) == 'idle v0.0.1' && $(cat .install-release) == "$next" ]] || fail 'the updater ignores a request while the button is off'
gtmworks update-button on || fail 'gtmworks update-button on'
# A release whose app never comes up, after its migration ran: the updater puts v0.0.1 back from the update's backup.
docker build -q -t localhost:5000/gtmworks:0.0.2-ci - > /dev/null <<'DOCKERFILE' || fail 'build the broken release image'
FROM localhost:5000/gtmworks:0.0.1-ci
RUN echo 'create table gtmworks_install.broken_release_probe(id integer);' > /app/install/supabase/migrations/99999999999999_broken_release_probe.sql \
 && echo 'process.exit(1);' > /app/scripts/web-server.mjs
DOCKERFILE
broken=$(publish 0.0.2-ci) || fail 'push the broken release image'
(cd "$workspace" && node scripts/release-assets.mjs "$broken" "$releases/v0.0.2" "$sandbox") || fail 'the broken release files'
echo '[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"},{"tag_name":"v0.0.2"}]' > "$releases/releases.json"
[[ $(owner request) == requested ]] || fail "the Owner's request for the broken release"
if gtmworks updater; then cat .gtmworks-updater.log; fail 'the update to the broken release must fail'; fi
cat .gtmworks-updater.log
grep -F 'broken_release_probe' .gtmworks-updater.log || fail 'the broken release applied its migration before it failed'
[[ $(cat .install-release) == "$next" && $(cat .gtmworks-version) == v0.0.1 ]] || fail 'the updater put v0.0.1 back'
[[ $(db -c "select to_regclass('gtmworks_install.broken_release_probe') is null") == t ]] || fail 'the data from before the broken update is back'
[[ $(state) == 'failed v0.0.1' ]] || fail 'the failure is recorded with the version still running'
[[ $(owner read) == 'failed v0.0.1 button-on' ]] || fail 'the Owner reads that the update failed and v0.0.1 runs'
probe 'after the broken update was put back'
# Automatic updates on: the next good release is installed without a click. The hour since the last check has passed.
docker build -q -t localhost:5000/gtmworks:0.0.3-ci - > /dev/null <<'DOCKERFILE' || fail 'build the next good release image'
FROM localhost:5000/gtmworks:0.0.1-ci
RUN echo 'create table gtmworks_install.auto_update_probe(id integer);' > /app/install/supabase/migrations/99999999999999_auto_update_probe.sql
DOCKERFILE
later=$(publish 0.0.3-ci) || fail 'push the next good release image'
(cd "$workspace" && node scripts/release-assets.mjs "$later" "$releases/v0.0.3" "$sandbox") || fail 'the next good release files'
echo '[{"tag_name":"v0.0.0"},{"tag_name":"v0.0.1"},{"tag_name":"v0.0.2"},{"tag_name":"v0.0.3"}]' > "$releases/releases.json"
gtmworks auto-update on || fail 'gtmworks auto-update on'
db -c "update public.install_updates set auto_checked_at=now() - interval '2 hours'" > /dev/null || fail 'the hour since the last check'
gtmworks updater || { cat .gtmworks-updater.log; fail 'the automatic update'; }
[[ $(cat .install-release) == "$later" && $(cat .gtmworks-version) == v0.0.3 ]] || fail 'automatic updates install the newest release without a click'
[[ $(state) == 'updated v0.0.3' ]] || fail 'the automatic update is recorded'
probe 'after the automatic update'
# Checked a moment ago: the next run does nothing.
gtmworks updater || fail 'the updater right after a check'
[[ $(cat .install-release) == "$later" ]] || fail 'the updater waits an hour between checks'
}

# staged-update: the staged removal of Agent levels (ADR 0023) against the release an existing install runs before it, the
# same fixed commit the sandbox-update area updates from. Its migrations apply before this release starts, and the cutover
# only once this release answers. Two updates fail after those migrations, one whose work sandbox does not start and one
# whose Engine does not: each puts the previous release's Engines back, and the previous release keeps serving on its own
# schema, which its own code proves (its worker records a profile with its level, its app's Conversation is answered, and
# its call that makes an Agent for Lead still reaches its database function). Then the update itself: the cutover removes
# the level, its past change still reads, and the profile is confirmed with the one fixed set of tools.
staged_update() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
before_sandbox=$before_sandbox_release_commit
git cat-file -e "$before_sandbox^{commit}" 2> /dev/null || git fetch --no-tags origin "$before_sandbox" || fail 'the release before the staged removal commit'
git worktree add "$RUNNER_TEMP/staged-previous-release" "$before_sandbox" || fail 'the release before the staged removal checkout'
release_image "$before_sandbox" localhost:5000/gtmworks:0.0.0-staged "$RUNNER_TEMP/staged-previous-release" --build-arg NEXT_SKIP_CHECKS=true \
  || fail 'build the release before the staged removal'
before=$(publish 0.0.0-staged) || fail 'push the release before the staged removal'
( cd "$RUNNER_TEMP/staged-previous-release" && node scripts/release-assets.mjs "$before" "$root/release-before-staged" ) || fail 'the release before the staged removal files'
publish_releases
publish_broken_sandbox_release
publish_broken_engine_release
dir="$PWD/staged-release-install"
mkdir "$dir" && cp release-before-staged/docker-compose.install.yml release-before-staged/install.sh "$dir/" || fail 'the release before the staged removal folder'
sh "$dir/install.sh" || fail 'install the release before the staged removal'
cd "$dir"
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) \
  -e SETUP_CODE="$code" -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" || fail 'first run on the release before the staged removal'
company=$(db -c "select id from public.companies where name='Proxy Company'") || fail 'read the Company'
for attempt in $(seq 1 240); do
  [[ $(db -c "select count(*) from public.company_profiles where company_id='$company' and tools_level is not null and not tools_pending") == 1 ]] && break
  [[ $attempt == 240 ]] && fail "the previous release's worker sets up the Company profile"
  sleep 1
done
owner=$(db -c "select person_id from public.members where company_id='$company' and role='owner'") || fail "read the Company's Owner"
db -c "begin; select set_config('request.jwt.claims','{\"sub\":\"$owner\",\"role\":\"authenticated\"}',true); set local role authenticated; select public.set_agent_level('$company',2); commit;" > /dev/null \
  || fail 'the Owner changes the Company level on the previous release'
staged_level_log() { db -c "select json_build_object('id',id,'subject',subject,'action',action,'details',details)::text from public.company_log where company_id='$company' and action='agent_level_changed'"; }
level_before=$(staged_level_log) || fail 'read the level change from the log'
staged_level_column() { db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='companies' and column_name='agent_level'"; }
staged_cutovers() { db -c "select count(*) from gtmworks_install.schema_migrations where name like '%\\_cutover.sql'"; }
web=$(compose ps -q web) worker=$(compose ps -q worker)
engine_image=$(docker inspect -f '{{.Config.Image}}' gtmworks-engine-first)
# What a failed update must leave (ADR 0023): the previous release's app and worker, never replaced; its Engine from its own
# template again, with no sandbox or exit beside it; the first step's columns, the level still there and no cutover; and
# that release's own code working on it.
previous_release_serves() {
  [[ $(compose ps -q web) == "$web" && $(compose ps -q worker) == "$worker" ]] || fail_update "the update $1 leaves the previous release's app and worker serving"
  probe "after the update $1"
  [[ $(docker inspect -f '{{.Config.Image}}' gtmworks-engine-first) == "$engine_image" ]] || fail_update "the update $1 starts the previous release's Engine again"
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' gtmworks-engine-first) == healthy ]] || fail_update "the previous release's Engine is healthy after the update $1"
  [[ -z $(docker ps -aq --filter 'name=^gtmworks-(sandbox|exit)-') ]] || fail_update "the update $1 leaves no sandbox or exit beside the previous release's Engine"
  [[ ! -e .work-sandbox-image ]] || fail_update "the update $1 records no work sandbox image"
  [[ $(staged_level_column) == 1 && $(staged_cutovers) == 0 ]] || fail_update "the update $1 keeps the level and applies no cutover"
  [[ $(db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='company_profiles' and column_name='tools_confirmed'") == 1 ]] \
    || fail_update "the update $1 applied the first step of the staged removal"
  # The previous release's worker records the Company profile again with its own function and its level.
  db -c "update public.company_profiles set tools_pending=true where company_id='$company'" > /dev/null || fail 'mark the Company profile as changing'
  for attempt in $(seq 1 180); do
    [[ $(db -c "select count(*) from public.company_profiles where company_id='$company' and tools_level is not null and not tools_pending") == 1 ]] && break
    [[ $attempt == 180 ]] && fail_update "after the update $1 the previous release's worker records the Company profile with its level"
    sleep 1
  done
  # Its call that makes an Agent for Lead, by the names it passes, still reaches the database function; so does this
  # release's, by its own names, with no ambiguity between them.
  compose exec -T web node --input-type=module -e "
    const call=async args=>{ const response=await fetch('http://gateway:8080/rest/v1/rpc/lead_create_agent',{method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({conversation:crypto.randomUUID(),run:'staged',call:'staged',agent_name:'Staged',job:'Checks the staged removal.',apps:[],...args})}); return response.status+' '+await response.text(); };
    for(const args of [{own_level:1,own_policy:1},{},{own_profile:true}]) { const answer=await call(args); console.log(answer); if(answer!=='200 {\"state\": \"refused\"}'&&answer!=='200 {\"state\":\"refused\"}') process.exit(1); }" < /dev/null \
    || fail_update "after the update $1 both releases' calls that make an Agent for Lead reach their function"
  # And its app's Conversation is answered by its worker, through its own code.
  engine_node "$(first_engine_key)" - < "$RUNNER_TEMP/staged-previous-release/scripts/check-install-conversation.mjs" \
    || fail_update "after the update $1 the previous release answers a Conversation"
}
# The previous release's own Engine files, as its install left them: each failed update leaves them so (#554), even while
# an Engine of the release that does not start restarts on the files that release brought.
staged_engine_files=$(cd scripts && cksum engine-*) || fail "read the previous release's Engine files"
for failing in sandbox engine; do
  cp "$root/release-broken-$failing/docker-compose.install.yml" "$root/release-broken-$failing/install.sh" . || fail "the release files whose $failing does not start in place"
  if GTMWORKS_ENGINE_WAIT=40 sh install.sh update > update.log 2>&1; then fail_update "the update whose $failing does not start must fail"; fi
  grep -Fq 'the previous release keeps serving, with its own Engines again' update.log || fail_update "the update whose $failing does not start says the previous release keeps serving"
  [[ $(cd scripts && cksum engine-* 2>&1) == "$staged_engine_files" ]] || fail_update "the update whose $failing does not start leaves the previous release's own Engine files"
  # The release files of a failed update stay in the folder, as a real one leaves them: the previous release's own go
  # back with its command (scripts/get.sh); here they go back by hand.
  cp "$root/release-before-staged/docker-compose.install.yml" "$root/release-before-staged/install.sh" . || fail "the previous release files back after the $failing failure"
  previous_release_serves "whose $failing does not start"
done
# The update itself: this release starts, then the cutover removes the level; its past change still reads, and the
# Company profile is confirmed with the one fixed set of tools.
cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail 'this release files in place'
sh install.sh update > update.log 2>&1 || fail_update 'the staged update to this release'
grep -Fq 'Applying migration: 20270416000000_one_set_of_tools_cutover.sql' update.log || fail_update 'the update applies the cutover'
[[ $(grep -n 'Applying migration: 20270416000000_one_set_of_tools_cutover.sql' update.log | cut -d: -f1) -gt $(grep -n 'gateway:8080/api/health 200' update.log | cut -d: -f1) ]] \
  || fail_update 'the cutover applies after this release answers'
[[ $(staged_level_column) == 0 && $(staged_cutovers) == 1 ]] || fail 'the update removes the level at the cutover'
[[ $(staged_level_log) == "$level_before" ]] || fail 'the past level change stays in the log as it was'
compose exec -T -e LEVEL_ROW="$level_before" web node --input-type=module -e "const {describeEntry}=await import('/app/lib/activity-log.mjs'); const read=describeEntry(JSON.parse(process.env.LEVEL_ROW)); console.log(JSON.stringify([read.act,read.from,read.to]));" \
  | grep -qxF '[["logActAgentLevel"],{"key":"agentLevel1"},{"key":"agentLevel2"}]' || fail 'the past level change still reads in the log'
[[ $(db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_agent_level','engine_tool_policy')") == 0 ]] \
  || fail "the cutover removes the previous release's level functions"
for attempt in $(seq 1 240); do
  [[ $(db -c "select count(*) from public.company_profiles where company_id='$company' and tools_confirmed and not tools_pending") == 1 ]] && break
  [[ $attempt == 240 ]] && fail 'the worker confirms the Company profile with the fixed set after the cutover'
  sleep 1
done
compose exec -T web node --input-type=module -e "
  const {engineOf}=await import('/app/lib/company-engine.mjs'); const {readToolsets}=await import('/app/lib/engine/agents.mjs'); const {toolsDiffer,companyProfile}=await import('/app/lib/agent-toolsets.mjs');
  const engine=await engineOf('$company'); const read=await readToolsets({address:engine.address,key:engine.key,profile:companyProfile('$company')});
  console.log(read.state,(read.toolsets||[]).join(' ')); if(read.state!=='found'||toolsDiffer(read.toolsets,{subagents:false})) process.exit(1);" < /dev/null \
  || fail "the Company profile's Engine offers the one fixed set of tools after the cutover"
}

# sandbox-rollback: a failed update of a release that already runs a work sandbox for each of two Companies (#504). This
# release is installed from its own two files, gets a second Company, then takes two updates that fail after the sandboxes
# were begun: one whose work sandbox image does not start and one whose Engine image does not start. Each puts the previous
# release's own Engines and sandboxes back (restore_previous_engine, ADR 0023), which reads each Engine's own sandbox key
# before starting it and counts a sandbox restored only once its own Engine reaches it over SSH. After each, every Company's
# Engine reaches its own sandbox over SSH, as its Agents' commands do, that sandbox takes its own Engine's key and no other
# Company's, every sandbox and exit runs the image the install recorded before, and each work folder keeps what it held; the
# install records again the release that keeps serving (#583), a backup with the failed release's files is refused, and
# one with that release's files after both succeeds. An Agent of each Company then runs a command in its own sandbox. Its own area,
# as the other update areas run near their 12-minute limit.
sandbox_rollback() {
cd "$root"
reset_install
trap - EXIT
set +o pipefail
fail_prefix='release install check failed: '
start_registry
publish_releases
# A release whose work sandbox does not start, and one whose Engine does not start, both made from this one. Only the first
# pins another sandbox image, so it is the failure that proves the image recorded before comes back; the second keeps it.
publish_broken_sandbox_release
publish_broken_engine_release
echo "this release: $first; its sandbox image: $sandbox; broken sandbox: $broken_sandbox; broken Engine: $broken_engine"
dir="$PWD/rollback-release-install"
docker run --rm -v "$PWD:/work" alpine:3.21 rm -rf /work/rollback-release-install || fail 'remove an earlier rollback install folder'
mkdir "$dir" && cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" "$dir/" || fail 'the rollback install folder'
sh "$dir/install.sh" || fail 'install this release from its own files'
cd "$dir"
[[ $(cat .work-sandbox-image) == "$sandbox" ]] || fail 'the install records the work sandbox image its release pins'
code=$(sed -n 's/^SETUP_CODE=//p' .env.install)
docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) \
  -e SETUP_CODE="$code" -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
  node:22.14.0-alpine3.21 node --input-type=module - < "$root/scripts/check-install-proxy.mjs" || fail 'first run before the failed updates'
second_company install.sh || fail 'company add makes the second Company'
for attempt in $(seq 1 240); do
  db -F ' ' -c "select c.id,a.profile,e.address from public.companies c join public.hermes_agents a on a.company_id=c.id and a.is_default join public.company_engines e on e.id=c.engine_id order by e.created_at" > engines.txt
  [[ $(grep -c . engines.txt || true) -ge 2 ]] && break
  [[ $attempt == 240 ]] && fail 'two Companies get a main Agent each on their own Engine'
  sleep 1
done
# What each Company's main Agent was told before the updates, in its own Engine's profile: the code word
# scripts/check-install-engines.mjs looks for after them.
while read -r company profile address; do
  container=${address#*://}; container=${container%%:*}
  tell_engine "$container" "$profile" "backup-${company//-/}" < /dev/null || fail "write a memory in the Engine of $company"
done < engines.txt
# What each Company has before the updates: its Engine's image, its sandbox key's public half, and a file in its work folder.
rollback_marker="rollback-work-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
: > companies-before
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME); slug=${name#gtmworks-engine-}
  public=$(sandbox_public_of "$(engine_value "$folder" VOLUME)") || fail "read the sandbox key of $name"
  [[ $public == ssh-ed25519\ * ]] || fail "the Engine $name has a sandbox key"
  docker exec "gtmworks-sandbox-$slug" sh -ec 'printf "%s" "$1" > "/work/$1.txt"' sh "$rollback_marker-$slug" || fail "write in the work folder of $name"
  # The public key is the line's last field: it holds spaces of its own.
  echo "$slug $(docker inspect -f '{{.Config.Image}}' "$name") $public" >> companies-before
done
[[ $(grep -c . companies-before) == 2 ]] || fail 'this release runs an Engine and a sandbox for each Company'
[[ $(cut -d' ' -f4 companies-before | sort -u | grep -c .) == 2 ]] || fail 'each Engine has a sandbox key of its own'
web=$(compose ps -q web)
for failing in sandbox engine; do
  cp "$root/release-broken-$failing/docker-compose.install.yml" "$root/release-broken-$failing/install.sh" . || fail "the release files whose $failing does not start in place"
  if GTMWORKS_ENGINE_WAIT=40 sh install.sh update > update.log 2>&1; then fail_update "the update whose $failing does not start must fail"; fi
  grep -Fq 'the previous release keeps serving, with its own Engines again' update.log || fail_update "the update whose $failing does not start says the previous release keeps serving"
  # The install records again the release that keeps serving (#583), so a backup with the failed release's own files is
  # refused before anything stops. The release whose sandbox does not start pins this release's own app image, which is
  # what the record names, so only the one whose Engine does not start is another release to refuse.
  [[ $(cat .install-release 2> /dev/null) == "$first" ]] || fail_update "the update whose $failing does not start records this release as the one it runs"
  if [[ $failing == engine ]]; then
    [[ $(sed -n 's/^release_image=//p' install.sh) == "$broken_engine" ]] || fail 'the release whose Engine does not start pins an app image of its own'
    mkdir -p "$dir/refused-backup"
    if sh install.sh backup "$dir/refused-backup" > backup.log 2>&1; then cat backup.log; fail "a backup with the files of the update whose $failing does not start must be refused"; fi
    grep -Fq "This install does not run $broken_engine yet" backup.log || { cat backup.log; fail "the backup with the files of the update whose $failing does not start names the release it does not run"; }
  fi
  # The release files of a failed update stay in the folder, as a real one leaves them: the previous release's own go
  # back with its command (scripts/get.sh); here they go back by hand.
  cp "$root/release-first/docker-compose.install.yml" "$root/release-first/install.sh" . || fail "this release files back after the $failing failure"
  [[ $(compose ps -q web) == "$web" ]] || fail_update "the update whose $failing does not start leaves this release's app serving"
  probe "after the update whose $failing does not start"
  [[ $(cat .work-sandbox-image) == "$sandbox" ]] || fail_update "the update whose $failing does not start keeps the work sandbox image recorded before"
  while read -r slug image public; do
    name="gtmworks-engine-$slug"
    [[ $(docker inspect -f '{{.Config.Image}}' "$name") == "$image" ]] || fail_update "the update whose $failing does not start runs the Engine $name from its image again"
    engine_healthy "$name" 60 || fail_update "the Engine $name is healthy after the update whose $failing does not start"
    for part in sandbox exit; do
      engine_healthy "gtmworks-$part-$slug" 60 || fail_update "the $part of $name is healthy after the update whose $failing does not start"
      [[ $(docker inspect -f '{{.Config.Image}}' "gtmworks-$part-$slug") == "$sandbox" ]] || fail_update "the $part of $name runs the image recorded before the update whose $failing does not start"
    done
    [[ $(sandbox_public_of "$(engine_value ".engines/$slug" VOLUME)") == "$public" ]] || fail_update "the Engine $name keeps its own sandbox key"
    # Its sandbox takes its own Engine's key, and the other Company's Engine's key is not among the ones it takes.
    keys=$(docker exec "gtmworks-sandbox-$slug" cat /home/pn/.ssh/authorized_keys) || fail_update "read the keys the sandbox of $name takes"
    grep -qF " $(cut -d' ' -f2 <<< "$public")" <<< "$keys" || fail_update "the sandbox of $name takes its own Engine's key after the update whose $failing does not start"
    while read -r other _ other_public; do
      [[ $other == "$slug" ]] && continue
      if grep -qF " $(cut -d' ' -f2 <<< "$other_public")" <<< "$keys"; then fail_update "the sandbox of $name takes no other Company's Engine key"; fi
    done < companies-before
    # The Engine reaches its own sandbox as every Agent's command does: over SSH, as its own user, with its own key and
    # the host key its known_hosts pins.
    reached=$(docker exec -u hermes "$name" ssh -i /opt/data/ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile=/opt/data/.ssh/known_hosts -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 pn@sandbox hostname) \
      || fail_update "the Engine $name reaches its sandbox over SSH after the update whose $failing does not start"
    [[ $reached == "$(docker exec "gtmworks-sandbox-$slug" hostname)" ]] || fail_update "the Engine $name reaches its own Company's sandbox after the update whose $failing does not start"
    [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$rollback_marker-$slug.txt") == "$rollback_marker-$slug" ]] || fail_update "the work folder of $name keeps what it held after the update whose $failing does not start"
  done < companies-before
done
# The Owner backs up with the files of the release that keeps serving, without running a failed update again (#583). One
# backup, after both: each failure above checked the record a backup reads, and a backup restarts every Engine, which the
# area's 12 minutes have room for once. The Agents' commands below then run on the Engines it started again.
mkdir -p "$dir/backup"
sh install.sh backup "$dir/backup" > backup.log 2>&1 || { cat backup.log; fail "a backup with this release's files after the failed updates"; }
[[ -f $(sed -n 's/^Backup: //p' backup.log | tail -n 1) ]] || { cat backup.log; fail 'the backup after the failed updates writes its archive'; }
# Each Company's main Agent runs a command in its own sandbox after both failed updates and still remembers what its own
# Engine was told; the job reads each sandbox for the file, and no other Company's sandbox has it.
agent_marker="sandbox-rollback-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
compose exec -T web node --input-type=module - sandbox "$agent_marker" < "$root/scripts/check-install-engines.mjs" > sandbox-rollback.log 2>&1 \
  || { cat sandbox-rollback.log; fail "each Company's Agent runs a command in its own sandbox after the failed updates and still remembers"; }
cat sandbox-rollback.log
while read -r company profile address; do
  slug=${address#http://gtmworks-engine-}; slug=${slug%%:*}; file="$agent_marker-${company//-/}"
  [[ $(docker exec "gtmworks-sandbox-$slug" cat "/work/$file.txt") == "$file" ]] || fail "the Agent of $company ran its command in its own Company's sandbox"
  while read -r other _; do
    [[ $other == "$slug" ]] && continue
    if docker exec "gtmworks-sandbox-$other" test -e "/work/$file.txt"; then fail "the file of $company's Agent is in no other Company's sandbox"; fi
  done < companies-before
done < engines.txt
}

# sizes: the measured sizes (#400). The README's two server sizes and the install's default sandbox limits come from these
# numbers, and a pull request runs them, so a change that makes a render outgrow the defaults fails here. On an install with
# two Companies it prints the memory the idle install services, each idle Engine and each idle sandbox use; runs one short
# render (Chromium frames joined by ffmpeg, sandbox/check/render.mjs) in the first Company's sandbox at the default
# limits, which must finish within them, and prints its peak memory and time; then gives the second Company's sandbox a
# memory limit below that render's peak and runs the same render there, which must be stopped at the limit while the
# first Company's sandbox keeps answering its Engine's key.
sizes() {
cd "$root"
area_setup
reset_install
install_source sizes-install.log || fail 'the sizes area install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
second_company || fail 'company add makes the second Company'
engine_id=$(first_engine_id) || fail 'the Engine container'
sandbox_image=$(cat .work-sandbox-image)
second_folder=$(ls -d .engines/* | grep -v '/first$')
second_container=$(engine_value "$second_folder" NAME)
first_sandbox=gtmworks-sandbox-first
second_sandbox=$(sandbox_of "$second_container")
for sandbox in "$first_sandbox" "$second_sandbox"; do
  engine_healthy "$sandbox" 60 || fail "the sandbox $sandbox is healthy"
  # Both sandboxes run at the install's defaults, read from the one place they are set (scripts/engine-template.yml).
  [[ $(docker inspect -f '{{.HostConfig.Memory}}' "$sandbox") == "$(sandbox_memory_bytes)" ]] || fail "the sandbox $sandbox has the install's default memory"
  [[ $(docker inspect -f '{{.HostConfig.NanoCpus}}' "$sandbox") == "$(sandbox_nano_cpus)" ]] || fail "the sandbox $sandbox has the install's default CPU"
done
echo "sizes: the default sandbox limits are memory $(sandbox_default mem_limit) and $(sandbox_default cpus) CPUs (scripts/engine-template.yml)"
# Idle: the worker has given each Company its main Agent; a minute lets the Engines settle before they are read.
sleep 60
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | tee idle-memory.log || fail 'read the idle memory of every container'
# The MiB a set of containers uses, summed from `docker stats`' MemUsage (e.g. 123.4MiB / 2GiB), by container name.
mib_of() {
  awk -v pattern="$1" '$1 ~ pattern { value=$2; unit=$2; sub(/[A-Za-z]+$/, "", value); sub(/^[0-9.]+/, "", unit)
    sum += unit == "GiB" ? value * 1024 : unit == "KiB" ? value / 1024 : unit == "B" ? value / 1048576 : value } END { printf "%d\n", sum }' idle-memory.log
}
services_idle=$(mib_of '^gtmworks-install-')
first_engine_idle=$(mib_of '^gtmworks-engine-first$')
second_engine_idle=$(mib_of "^$second_container\$")
first_sandbox_idle=$(mib_of "^$first_sandbox\$")
second_sandbox_idle=$(mib_of "^$second_sandbox\$")
(( services_idle > 0 && first_engine_idle > 0 && second_engine_idle > 0 && first_sandbox_idle > 0 && second_sandbox_idle > 0 )) || fail 'every idle container reports its memory'
echo "sizes: idle install services use $services_idle MiB; one idle Engine uses $first_engine_idle MiB (the second $second_engine_idle MiB); one idle sandbox uses $first_sandbox_idle MiB (the second $second_sandbox_idle MiB)"
# The OOM kills a sandbox's own cgroup has counted (cgroup v2's memory.events, or v1's memory.oom_control).
oom_kills() { docker exec "$1" sh -c 'cat /sys/fs/cgroup/memory.events 2> /dev/null || cat /sys/fs/cgroup/memory/memory.oom_control' | sed -n 's/^oom_kill //p'; }
# One short render at the defaults finishes, below the default memory, with no process of the sandbox killed.
docker exec -i "$first_sandbox" node --input-type=module - < sandbox/check/render.mjs | tee render-defaults.log \
  || fail 'one short render finishes in a sandbox at the default limits'
render_peak=$(sed -n 's/^render=.*"peakMiB":\([0-9]*\).*/\1/p' render-defaults.log)
render_seconds=$(sed -n 's/^render=.*"seconds":\([0-9.]*\).*/\1/p' render-defaults.log)
default_mib=$(( $(sandbox_memory_bytes) / 1048576 ))
[[ -n $render_peak && -n $render_seconds ]] || fail 'the render prints its peak memory and time'
(( render_peak < default_mib )) || fail "the render's peak memory ($render_peak MiB) is within the default limit ($default_mib MiB)"
[[ $(oom_kills "$first_sandbox") == 0 ]] || fail 'the render at the defaults had no process killed at the memory limit'
echo "sizes: one short render at the default limits took $render_seconds s and peaked at $render_peak MiB of the $default_mib MiB limit"
# The Company's Screen awake with a page open (#711), started as the pinned Engine starts it in its sandbox: its own
# launcher.sh, read out of the Engine's image, runs in the first Company's sandbox, and the sandbox's Chromium opens a
# page through the Company's exit. A Company has one awake Screen, shared by its Agents (vault decision 0068), and the
# default memory must hold it beside the render.
launcher=$(docker exec "$engine_id" base64 -w0 /opt/hermes/tools/bot_desktop/launcher.sh) || fail "the pinned Engine's Screen launcher"
docker exec -i -e SCREEN_LAUNCHER="$launcher" "$first_sandbox" node --input-type=module - < sandbox/check/screen.mjs | tee screen-defaults.log \
  || fail 'one Screen wakes with a page open in a sandbox at the default limits'
screen_peak=$(sed -n 's/^screen=.*"peakMiB":\([0-9]*\).*/\1/p' screen-defaults.log)
screen_awake=$(sed -n 's/^screen=.*"awakeMiB":\([0-9]*\).*/\1/p' screen-defaults.log)
[[ -n $screen_peak && -n $screen_awake ]] || fail 'the Screen prints its memory awake and its peak'
(( screen_peak + render_peak < default_mib )) || fail "a Screen ($screen_peak MiB) beside the render ($render_peak MiB) fits in the default limit ($default_mib MiB)"
[[ $(oom_kills "$first_sandbox") == 0 ]] || fail 'the Screen at the defaults had no process killed at the memory limit'
echo "sizes: the Screen awake with a page open held $screen_awake MiB and peaked at $screen_peak MiB of the $default_mib MiB limit"
# A render that needs more memory than its Company's limit: the second Company's sandbox gets four fifths of the render's
# measured peak, so Chromium renders part of the way before the limit stops it, and the first Company's sandbox is asked
# throughout. It is set on the running sandbox with `docker update`, the cgroup change a Company's own limit (`company
# limits`, #396, which the companies area proves) makes, because only this way can swap be held at the same figure so the
# render cannot spill into it.
low_mib=$(( render_peak * 4 / 5 ))
(( low_mib >= 64 )) || low_mib=64
(( render_peak > low_mib )) || fail "the render needs more memory ($render_peak MiB) than the low limit ($low_mib MiB)"
docker update --memory "${low_mib}m" --memory-swap "${low_mib}m" "$second_sandbox" > /dev/null || fail 'give the second sandbox a low memory limit'
[[ $(docker inspect -f '{{.HostConfig.Memory}}' "$second_sandbox") == $(( low_mib * 1048576 )) ]] || fail 'the second sandbox has the low memory limit'
kills_before=$(oom_kills "$second_sandbox")
since=$(date +%s)
docker exec -i "$second_sandbox" node --input-type=module - < sandbox/check/render.mjs > render-over-limit.log 2>&1 &
render_pid=$!
# While it runs, the first Company's sandbox answers its own Engine's key over ssh on its work network, as its Engine
# reaches it, and runs a command there.
first_key=$(docker exec "$engine_id" cat /opt/data/ssh/id_ed25519) || fail "the first Engine's sandbox key"
first_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-work-first").IPAddress}}' "$first_sandbox")
first_answers() {
  printf '%s\n' "$first_key" | docker run --rm -i -e SANDBOX_IP="$first_ip" --network gtmworks-work-first --entrypoint sh "$sandbox_image" -ec '
    cat > /tmp/key; chmod 600 /tmp/key
    ssh -i /tmp/key -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 pn@$SANDBOX_IP "ffmpeg -version | head -n 1"' > /dev/null
}
answers=0
while :; do
  first_answers || fail "the first Company's sandbox keeps answering while the second Company's render is at its limit"
  answers=$(( answers + 1 ))
  kill -0 "$render_pid" 2> /dev/null || break
  sleep 1
done
if wait "$render_pid"; then cat render-over-limit.log; fail "a render that needs more memory than its Company's limit is stopped"; fi
cat render-over-limit.log
kills_after=$(oom_kills "$second_sandbox" 2> /dev/null || true)
oom_events=$(docker events --since "$since" --until "$(date +%s)" --filter "container=$second_sandbox" --filter event=oom --format '{{.Action}}' | grep -c . || true)
(( ${kills_after:-0} > ${kills_before:-0} || oom_events > 0 )) || fail "the render was stopped by its sandbox's memory limit (oom_kill ${kills_before:-?} to ${kills_after:-?}, $oom_events oom events)"
first_answers || fail "the first Company's sandbox answers after the second Company's render was stopped"
engine_healthy "$first_sandbox" 10 || fail "the first Company's sandbox is still healthy"
echo "sizes: a render that needed $render_peak MiB was stopped at its Company's $low_mib MiB limit (oom_kill ${kills_before:-?} to ${kills_after:-?}, $oom_events oom events); the other Company's sandbox answered $answers times while it ran"
}

# measure: how much disk and memory twenty Agent profiles take (#126, #400, #408): ten more profiles in the first
# Company with the Engine's bundled Skills and ten without. It is no check a pull request needs, and its numbers are for
# the README: it runs on a push to main and on a manual run only (Omar, 2026-11-19). The area makes the install and the
# two Companies its prepare step reads, then prints each profile's seconds and the Engine's memory and disk around them,
# and the one line of numbers the README states. `all` runs it last, for a full run on a machine here.
measure() {
cd "$root"
area_setup
reset_install
install_source measure-install.log || fail 'first install'
complete_setup || fail 'emailed sign-in and invitation links on the local install'
# The second Company on its own Engine: the agents area's prepare step, which records the first Company's profile the
# measurement reads, looks for two Companies on two Engines (scripts/check-install-profiles.mjs).
second_company || fail 'company add makes the second Company'
engine_id=$(first_engine_id) || fail 'the Engine container'
engine_key=$(first_engine_key)
engine_node "$engine_key" - prepare < scripts/check-install-profiles.mjs > prepare-profiles.log || fail 'two companies get two profiles on two Engines with the work tools on, each with one shared space'
capacity() { engine_node "$engine_key" - capacity "$1" < scripts/check-install-profiles.mjs; }
engine_memory() { docker stats --no-stream --format '{{.MemUsage}}' "$engine_id"; }
engine_disk() { docker run --rm --volumes-from "$engine_id" --entrypoint sh "$(docker inspect -f '{{.Image}}' "$engine_id")" -ec 'du -sk /opt/data | cut -f1'; }
memory_before=$(engine_memory) || fail 'the Engine memory before the capacity profiles'
disk_before=$(engine_disk) || fail 'the Engine disk before the capacity profiles'
capacity with-skills | tee capacity-with-skills.log || fail 'ten more Agent profiles with the bundled Skills'
disk_with=$(engine_disk) || fail 'the Engine disk after the capacity profiles'
capacity no-skills | tee capacity-no-skills.log || fail 'ten more Agent profiles without the bundled Skills'
disk_without=$(engine_disk) || fail 'the Engine disk after the profiles without Skills'
memory_after=$(engine_memory) || fail 'the Engine memory after the capacity profiles'
per_with=$(( (disk_with-disk_before)/10 )) || fail 'the disk one profile with Skills takes'
per_without=$(( (disk_without-disk_with)/10 )) || fail 'the disk one profile without Skills takes'
echo "capacity: engine memory $memory_before before and $memory_after after 20 agent profiles; $per_with KiB per profile with the bundled Skills, $per_without KiB without"
# The twenty profiles are scanned as the Agents area scans its own: the Engine holds none of gtmworks's keys (#2, #408).
{ grep -E '^(POSTGRES_PASSWORD|PGSODIUM_ROOT_KEY|SUPABASE_JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|WEBHOOK_ENCRYPTION_KEY|SETUP_CODE)=' .env.install | docker exec -i -u hermes "$engine_id" /opt/hermes/.venv/bin/python -c "$(cat scripts/check-hermes-keys.py)"; } || fail "the Engine holds none of gtmworks's keys and passwords after the capacity profiles"
}

# The area named by the one argument, or all of them in the order the proof has always run them, then the measurement
# (#406, #408). A CI job names one area; `./ci.sh install` without one still runs the whole proof. Each area of `all` runs
# in a subshell of its own (#411): an area's fail_prefix, EXIT trap, HOME or cwd cannot reach the next one, and an area
# that relies on the prefix or the trap sets it at its start.
case "${1:-all}" in
 all) (first_install); (companies); (agents); (agents_sandbox); (open_design); (backup); (backup_engines); (proxy); (rollback); (update); (previous_archive); (release_update); (sandbox_update); (staged_update); (sandbox_rollback); (sizes); (engines_update); (one_line); (updater); (measure);;
 first-install) first_install;;
 companies) companies;;
 agents) agents;;
 agents-sandbox) agents_sandbox;;
 open-design) open_design;;
 backup) backup;;
 backup-engines) backup_engines;;
 proxy) proxy;;
 rollback) rollback;;
 update) update;;
 previous-archive) previous_archive;;
 release-update) release_update;;
 sandbox-update) sandbox_update;;
 staged-update) staged_update;;
 sandbox-rollback) sandbox_rollback;;
 sizes) sizes;;
 engines-update) engines_update;;
 one-line) one_line;;
 updater) updater;;
 measure) measure;;
 *) echo 'usage: bash scripts/ci-install-check.sh [first-install | companies | agents | agents-sandbox | open-design | backup | backup-engines | proxy | rollback | update | previous-archive | release-update | sandbox-update | staged-update | sandbox-rollback | sizes | engines-update | one-line | updater | measure]' >&2; exit 2;;
esac
