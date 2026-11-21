#!/usr/bin/env bash
# The install proof, one command of the repo (#402): each CI install job runs this file for its area on an isolated
# Docker machine and holds no check of its own, and `./ci.sh install [area]` starts such a machine here and runs it.
# Without an area the nine areas (spec #401's seven, `rollback` and `engines-update`, #389) run one after another, then the profile-size measurement; with one, only
# that area runs, on a fresh Docker machine: `first-install` (the first install and its repeat), `companies` (Companies
# and their Engines), `agents` (Agents on their Engines), `backup` (backup and restore), `proxy` (the public address
# behind a proxy), `rollback` (a failed update rolled back), `update` (the update between releases), `engines-update` (a release that pins another Engine image), `one-line` (the one-line install) and `measure` (the
# profile-size measurement, on a push to main and a manual run only, never on a pull request, #408). Every area makes
# the install, its first run, the Companies, the archives, the local registry and the release files it needs itself
# (#406–#409), so no area needs another to have run. The helpers the areas share are in scripts/ci-install-lib.sh,
# sourced below, so each is written once.
# DOCKER_HOST names that machine; RUNNER_TEMP is a scratch folder; INSTALL_REF and GH_TOKEN come from CI or ci.sh
# (GH_TOKEN only reaches the update's source download, scripts/install.sh).
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
[[ $(docker inspect -f '{{json .NetworkSettings.Ports}}' "$engine_id") != *HostPort* ]] || fail 'the Engine publishes no host port'
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
# network, which is internal (no way out until #394's exit service joins it), with its work volume mounted at /work.
sandbox_id=$(docker ps -q --filter 'name=^gtmworks-sandbox-first$') || fail 'the first sandbox container'
[[ -n $sandbox_id ]] || fail 'the first sandbox container'
[[ $(docker inspect -f '{{.Config.Image}}' "$sandbox_id") == "$(cat .work-sandbox-image)" ]] || fail 'the sandbox runs the image the install recorded'
[[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox_id") == healthy ]] || fail 'the sandbox is healthy'
[[ $(docker network inspect gtmworks-work-first -f '{{.Internal}}') == true ]] || fail "the sandbox's network has no way out"
[[ $(docker inspect -f '{{len .NetworkSettings.Ports}}' "$sandbox_id") == 0 ]] || fail 'the sandbox publishes no host port'
[[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Name}}{{end}}{{end}}' "$sandbox_id") == gtmworks-work-first ]] || fail "the Company's work folder is the sandbox's own volume"
[[ $(docker exec "$sandbox_id" id -un) == pn ]] || fail 'the sandbox runs as its own ordinary user'
# From the Engine's network nothing else of the install is reachable (db, auth, REST, storage, the gateway), and a
# request to the app there buys nothing with a forged visitor address.
docker run --rm --network gtmworks-engine-first -e INSTALL_SERVICE_IPS="$(install_service_ips)" -v "$PWD/scripts:/check:ro" \
  node:22.14.0-alpine3.21 node /check/check-install-engine-network.mjs \
  || fail "the Engine network reaches no install service, by name or address, and trusts no forged address"
# From the Company's work network, where its Agents' code runs, the install is unreachable too, and the Engine answers on
# its install-network address only: it binds its listeners there and nowhere else (#390, #393).
[[ $(docker network inspect gtmworks-work-first -f '{{range .Containers}}{{println .Name}}{{end}}' | grep . | sort) == $'gtmworks-engine-first\ngtmworks-sandbox-first' ]] \
  || fail 'the work network holds exactly its Engine and its sandbox'
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
[[ -n $engine_id && $(docker inspect -f '{{json .NetworkSettings.Ports}}' "$engine_id") != *HostPort* ]] || fail 'the Engine publishes no host port'
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
if GTMWORKS_ENGINE_WAIT=1 second_company > company-failed.log 2>&1; then
  cat company-failed.log; docker compose version
  fail 'company add with an Engine that never becomes healthy must fail'
fi
cat company-failed.log
grep -Fq 'Company "Second Company" was not made: its Engine did not become healthy. Nothing was left behind; run the same command again.' company-failed.log || fail 'a failed Engine is one plain line'
[[ $(ls -d .engines/* | wc -l) == 1 ]] || fail 'the failed add removed its Engine folder'
if docker ps -aq --filter 'name=^gtmworks-engine-' | while read -r id; do docker inspect -f '{{.Name}}' "$id"; done | grep -vq '^/gtmworks-engine-first$'; then fail 'the failed add left an Engine container'; fi
[[ $(docker volume ls -q --filter 'name=^gtmworks-engine' | wc -l) == 0 ]] || fail 'the failed add left an Engine volume'
[[ $(docker network ls -q --filter 'name=^gtmworks-engine' | wc -l) == 1 ]] || fail 'the failed add left an Engine network'
[[ -z $(docker ps -aq --filter 'name=^gtmworks-sandbox-second-company-') ]] || fail 'the failed add left a sandbox container'
if docker volume ls -q | grep -Eq '^gtmworks-(work|sandbox-hostkey)-second-company-'; then fail 'the failed add left a sandbox volume'; fi
if docker network ls --format '{{.Name}}' | grep -q '^gtmworks-work-second-company-'; then fail 'the failed add left a work network'; fi
[[ $(db -c "select count(*) from public.companies where name='Second Company'") == 0 ]] || fail 'the failed add left no Company'
[[ $(db -c "select count(*) from public.company_engines where address like '%second-company%'") == 0 ]] || fail 'the failed add left no Engine record'
# Running it again, on an Engine that becomes healthy, succeeds.
second_company || fail 'company add makes the second Company'
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
[[ $(docker inspect -f '{{json .NetworkSettings.Ports}}' "$second_container") != *HostPort* ]] || fail 'the second Engine publishes no host port'
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
# From inside the second Engine's network the first Engine cannot be reached, and neither can any install service.
docker run --rm --network "$second_network" node:22.14.0-alpine3.21 node --input-type=module -e "try { await fetch('http://gtmworks-engine-first:8642/health',{signal:AbortSignal.timeout(5000)}); process.exit(1); } catch { console.log('the other Engine is unreachable'); }" || fail 'one Engine cannot reach another'
docker run --rm --network "$second_network" -e INSTALL_SERVICE_IPS="$(install_service_ips)" -v "$PWD/scripts:/check:ro" \
  node:22.14.0-alpine3.21 node /check/check-install-engine-network.mjs || fail 'the second Engine network reaches no install service'
# The second Company's work network is its own: the first Company's Engine and its sandbox, and every install service,
# are unreachable from it.
[[ $(docker network inspect "$second_work_network" -f '{{range .Containers}}{{println .Name}}{{end}}' | grep . | sort) == $(printf '%s\n' "$second_container" "$second_sandbox" | sort) ]] \
  || fail 'the second work network holds exactly its Engine and its sandbox'
second_work_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$second_work_network\").IPAddress}}" "$second_container")
second_web_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-install_default").IPAddress}}' "$(compose ps -q web)" 2> /dev/null || true)
second_web_ip=${second_web_ip:-$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q web)")}
docker run --rm --network "$second_work_network" -e INSTALL_SERVICE_IPS="$(install_service_ips),web=$second_web_ip" -e ENGINE_WORK_IP="$second_work_ip" -e OTHER_ENGINES="gtmworks-engine-first" \
  -e ENGINE_WORK_PORTS="$(engine_listen_ports "$second_container")" \
  -v "$PWD/scripts:/check:ro" node:22.14.0-alpine3.21 node /check/check-install-work-network.mjs \
  || fail 'the second work network reaches no install service, no other Engine and no listener of its own Engine'
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
  [[ $(docker inspect -f '{{.HostConfig.Memory}}' "$sandbox") == 2147483648 ]] || fail "the sandbox of $slug has the install's default memory"
  [[ $(docker inspect -f '{{.HostConfig.NanoCpus}}' "$sandbox") == 2000000000 ]] || fail "the sandbox of $slug has the install's default CPU"
  [[ $(docker inspect -f '{{len .NetworkSettings.Ports}}' "$sandbox") == 0 ]] || fail "the sandbox of $slug publishes no host port"
  if docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$sandbox" | grep -q 'docker.sock'; then fail "the sandbox of $slug mounts no Docker socket"; fi
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
# `gtmworks company list` and `gtmworks status` report each Company's own Engine and its state.
sh scripts/install.sh company list | tee company-list.log || fail 'company list'
grep -F '"Proxy Company": Engine http://gtmworks-engine-first:8642 (healthy)' company-list.log || fail 'company list names the first Company and its healthy Engine'
grep -F "\"Second Company\": Engine $second_address (healthy)" company-list.log || fail 'company list names the second Company and its healthy Engine'
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
# The memory one idle Engine and its Company's sandbox use, printed for the README.
echo "one idle Engine uses $(docker stats --no-stream --format '{{.MemUsage}}' "$second_container")"
echo "one idle sandbox uses $(docker stats --no-stream --format '{{.MemUsage}}' "$second_sandbox")"
# Stopping the second Company's Engine leaves the first Company answering, then the second Engine starts again.
docker stop "$second_container" > /dev/null || fail 'stop the second Engine'
engine_node "$engine_key" - < scripts/check-install-conversation.mjs || fail 'the first Company still answers while the second Engine is stopped'
docker start "$second_container" > /dev/null || fail 'start the second Engine'
engine_healthy "$second_container" 120 || fail 'the second Engine is healthy again'
}

# agents: Agents on their Engines (#378, #408): an Agent made and run through the contract, the Engine management listener
# never public, the profile of each Company with the terminal, files and code execution on run in its Company's work
# sandbox, the apps, and the scan that neither the Engine nor the sandbox holds a key of gtmworks. The area makes the install it starts from, its first run and its second Company
# itself, so first-install no longer runs it (#408).
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
# Apps (#30), on the first company's profile with no vendor sign-in: the registry's apps are in the pinned
# catalogue, connecting writes only an app's read tools and the way back to gtmworks, an unknown way back is
# expired, and disconnecting turns the app off.
engine_node "$engine_key" - < scripts/check-install-apps.mjs || fail 'apps write only their read tools and come back through gtmworks'
# The Engine holds none of gtmworks's own keys and passwords (#2): its environment and every file its user can
# read are scanned for the real values in .env.install, passed on stdin; only names and paths are printed. Every
# Engine of the install is scanned, the first and each Company's own (#382).
engines_scanned=0
for folder in .engines/*/; do
  [ -f "$folder/.env" ] || continue
  name=$(engine_value "$folder" NAME)
  [[ -n $(docker ps -q --filter "name=^${name}$") ]] || fail "the Engine container $name"
  engines_scanned=$((engines_scanned+1))
  { grep -E '^(POSTGRES_PASSWORD|PGSODIUM_ROOT_KEY|SUPABASE_JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|WEBHOOK_ENCRYPTION_KEY|SETUP_CODE)=' .env.install | docker exec -i -u hermes "$name" /opt/hermes/.venv/bin/python -c "$(cat scripts/check-hermes-keys.py)"; } || fail "the Engine $name holds none of gtmworks's keys and passwords"
  # The sandbox runs the Agents' code, so it is scanned too, with its own Engine's key added: a sandbox never holds the
  # Engine's API key either (#393).
  { { grep -E '^(POSTGRES_PASSWORD|PGSODIUM_ROOT_KEY|SUPABASE_JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|WEBHOOK_ENCRYPTION_KEY|SETUP_CODE)=' .env.install; printf 'ENGINE_KEY=%s\n' "$(engine_value "$folder" KEY)"; } | docker exec -i -u pn "$(sandbox_of "$name")" python3 -c "$(cat scripts/check-hermes-keys.py)"; } || fail "the sandbox of $name holds none of gtmworks's keys, and not its Engine's key"
done
[[ $engines_scanned -ge 2 ]] || fail 'the scan covers every Engine'
}

# backup: backup and restore (#386, #409, ADR 0018): a backup of the install's own data and of every Company Engine,
# restored into a fresh install with identities, keys and migration history intact; and an archive naming an Engine
# without its data, or holding a hard link, refused before anything changes (#378, C4, C15). An archive made before
# Engines existed is the previous release's own, so the update area restores it (#378, C3). The area makes the install,
# the Companies and the archives it needs (#409): it starts on a fresh isolated Docker machine, completes first run for
# the first Company, and adds a second Company on an Engine of its own.
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
db -c 'select name from gtmworks_install.schema_migrations order by name' > restored
diff -u before restored || fail 'restored migration history'
# A second Company on an Engine of its own for the every-Engine archive: the first run's Owner is its Owner, and the
# worker gives it its main Agent by itself.
second_company || fail 'the second Company for the every-Engine backup'
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
# The install is made empty and the one archive brings both Companies and both Engines back.
remove_install || fail 'remove the install before the every-Engine restore'
rm -f .env.install
sh scripts/install.sh || fail 'fresh install before the every-Engine restore'
sh scripts/install.sh restore "$every_engine" || fail 'restore every Engine'
[[ $(ls -d .engines/*/ | wc -l) == "$engines_before" ]] || fail 'the every-Engine restore brings every Engine back'
for folder in .engines/*/; do
  name=$(engine_value "$folder" NAME)
  volume=$(engine_value "$folder" VOLUME)
  network=$(engine_value "$folder" NETWORK)
  engine=$(docker ps -q --filter "name=^${name}$")
  [[ -n $engine ]] || fail "the restored install runs the Engine $name"
  [[ $(docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' "$engine") == "$volume" ]] || fail "the Engine $name keeps its own volume"
  [[ $(docker inspect -f '{{range $other, $_ := .NetworkSettings.Networks}}{{println $other}}{{end}}' "$engine" | grep . | sort) == $(printf '%s\n' "$network" "gtmworks-work-${name#gtmworks-engine-}" | sort) ]] || fail "the Engine $name joins its own network and its work network only"
  # The lifecycle seed's two Companies (restore-one, restore-two) hold records of their own at the first Engine's address.
  [[ $(db -c "select count(*) from public.companies c join public.company_engines e on e.id=c.engine_id where e.address='http://$name:8642'") -ge 1 ]] || fail "a Company's record names the Engine $name"
  for service in web worker; do
    docker inspect -f '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$(compose ps -q "$service")" | grep -qx "$network" \
      || fail "the $service joins the network of the Engine $name"
  done
  sandbox=$(docker ps -q --filter "name=^gtmworks-sandbox-${name#gtmworks-engine-}$")
  [[ -n $sandbox ]] || fail "the restored install runs the sandbox of $name"
  [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$sandbox") == healthy ]] || fail "the restored sandbox of $name is healthy"
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
# A Run on each Company answers on its own Engine, and the code word its own Engine kept reaches its own Run only.
compose exec -T web node --input-type=module - < scripts/check-install-engines.mjs || fail 'every Company answers on its own Engine after the restore'
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
if sh scripts/install.sh update "$INSTALL_REF" > update.log 2>&1; then fail_update 'update must fail'; fi
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
# record, no companies.engine_id), its own one `hermes` service, and its own key in .env.install. It is a fixed commit,
# not this pull request's base or origin/main: after this release merges, main has the Engines, and the update proof would
# build this release's own shape twice and prove nothing (#378, C1).
previous_release=8f47abe1761548a45de72937fac443a4bdea3eb6
git cat-file -e "$previous_release^{commit}" 2> /dev/null || git fetch --no-tags origin "$previous_release" || fail 'the previous release commit'
git worktree add "$RUNNER_TEMP/previous-release" "$previous_release" || fail 'the previous release checkout'
docker build -q -t localhost:5000/gtmworks:0.0.0-main "$RUNNER_TEMP/previous-release" > /dev/null || fail 'build the previous release image'
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
docker exec -i gtmworks-install-hermes-1 sh -ec \
  'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown -R hermes:hermes "/opt/data/profiles/$1"' \
  sh "$profile" "$marker" || fail "write a memory in the Company's profile"
docker exec -i gtmworks-install-hermes-1 sh -ec \
  'umask 077; printf "%s\n" "{\"accessToken\":\"install-check-token\",\"refreshToken\":\"install-check-refresh\",\"expiresAt\":4102444800000}" > /opt/data/.anthropic_oauth.json; chown hermes:hermes /opt/data/.anthropic_oauth.json' \
  || fail 'sign the Company in on the Engine before the update'
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
# The update to this release: it applies the migrations (including the Engine records), adopts the Engine the
# previous release ran, and leaves the Company answering from its record.
sh install.sh update || fail 'release update'
[[ $(first_engine_key) == "$key" ]] || fail 'the update adopted the Engine key'
if grep -q '^HERMES_API_KEY=' .env.install; then fail 'the update left no Engine key in .env.install'; fi
engine=$(first_engine_id)
[[ -n $engine ]] || fail "the updated install runs the Company's Engine"
[[ $(docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' "$engine") == gtmworks-install_hermes ]] || fail 'the Engine keeps the volume the previous release used'
hermes_image=$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)
[[ $(docker inspect -f '{{.Config.Image}}' "$engine") == "$hermes_image" ]] || fail 'the Engine runs the template image'
[[ $(docker inspect -f '{{json .NetworkSettings.Ports}}' "$engine") != *HostPort* ]] || fail 'the Engine publishes no host port'
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
# The release pins another Engine image: the pinned image under another tag, so the update runs the same Hermes without
# another pull.
docker tag "$hermes_image" gtmworks-engine-check:0.0.2 || fail 'tag the other Engine image'
docker build -q -t localhost:5000/gtmworks:0.0.2-ci - > /dev/null <<'DOCKERFILE' || fail 'build the release that pins another Engine image'
FROM localhost:5000/gtmworks:0.0.1-ci
RUN sed -i '0,/^\( *image:\).*/s//\1 gtmworks-engine-check:0.0.2/' /app/install/scripts/engine-template.yml
DOCKERFILE
fourth=$(publish 0.0.2-ci) || fail 'push the release that pins another Engine image'
( cd "$root" && node scripts/release-assets.mjs "$fourth" release-engines "$sandbox" ) || fail 'the release files that pin another Engine image'
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
  [[ $(docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' "$engine") == "$volume" ]] || fail "the Engine $name keeps its own volume through the update"
  [[ $(docker inspect -f '{{range $other, $_ := .NetworkSettings.Networks}}{{println $other}}{{end}}' "$engine" | grep . | sort) == $(printf '%s\n' "$network" "gtmworks-work-${name#gtmworks-engine-}" | sort) ]] || fail "the Engine $name joins its own network and its work network only after the update"
done
# A Run on each Company answers on its own Engine, and the code word its own Engine kept reaches its own Run only.
compose exec -T web node --input-type=module - < "$root/scripts/check-install-engines.mjs" || fail 'a Run on each Company answers after the update'
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
 && echo 'process.exit(1);' > /app/server.js
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

# The area named by the one argument, or all nine in the order the proof has always run them, then the measurement
# (#406, #408). A CI job names one area; `./ci.sh install` without one still runs the whole proof. Each area of `all` runs
# in a subshell of its own (#411): an area's fail_prefix, EXIT trap, HOME or cwd cannot reach the next one, and an area
# that relies on the prefix or the trap sets it at its start.
case "${1:-all}" in
 all) (first_install); (companies); (agents); (backup); (proxy); (rollback); (update); (previous_archive); (engines_update); (one_line); (updater); (measure);;
 first-install) first_install;;
 companies) companies;;
 agents) agents;;
 backup) backup;;
 proxy) proxy;;
 rollback) rollback;;
 update) update;;
 previous-archive) previous_archive;;
 engines-update) engines_update;;
 one-line) one_line;;
 updater) updater;;
 measure) measure;;
 *) echo 'usage: bash scripts/ci-install-check.sh [first-install | companies | agents | backup | proxy | rollback | update | previous-archive | engines-update | one-line | updater | measure]' >&2; exit 2;;
esac
