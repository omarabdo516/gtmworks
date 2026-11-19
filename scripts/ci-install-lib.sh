#!/usr/bin/env bash
# The helpers the install proof's areas share (#402), sourced by scripts/ci-install-check.sh: each is written once, here,
# so a change to how the install is reached, to an Engine's address or to the key of its Engine is made in one place.
# The file defines functions and two addresses; it prints no check of its own.
#
# A failure keeps the sentence and the prefix of the area that prints it: fail_prefix names the step the area ran in
# before the move (#402).
fail() { echo "${fail_prefix}$1" >&2; exit 1; }
# The failed update prints the update's own log before its sentence.
fail_update() { cat update.log >&2; fail "$1"; }
# The install's own Compose project and its database (docker-compose.install.yml).
compose() { docker compose --env-file .env.install -f docker-compose.install.yml "$@"; }
db() { compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
migrations() { db -c 'select name from gtmworks_install.schema_migrations order by name'; }
# First run as the person who installed gtmworks (issue #40): the emailed sign-in link reaches the Company home, an
# invitation link returns to the app, and a sign-in request with a forged X-Forwarded-Host still gets a link on
# APP_ORIGIN; completing setup with the install's own code makes the first Company and its Owner. The keys pass as an
# env file, so none is printed. The areas that need a completed first install call it (first-install, backup, #409).
complete_first_run() {
  docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) --env-file <(grep -E '^SETUP_CODE=' .env.install) \
    -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
    node:22.14.0-alpine3.21 node --input-type=module - < scripts/check-install-proxy.mjs
}
# Each install service's own address on the install network, so the Engine-network probe checks addresses as well
# as names, which do not resolve there (#378, S5).
install_service_ips() {
  for service in db auth rest storage gateway; do
    address=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q "$service")")
    printf '%s=%s,' "$service" "$address"
  done | sed 's/,$//'
}
# The first Engine (ADR 0018): its addresses on the install network, the container that runs it, and the key in its own
# file, which is never in the install's environment (#385).
engine_address=http://gtmworks-engine-first:8642
engine_management=http://gtmworks-engine-first:9119
first_engine_id() { docker ps -q --filter 'name=^gtmworks-engine-first$'; }
first_engine_key() { sed -n 's/^ENGINE_KEY=//p' .engines/first/.env 2> /dev/null || true; }
# The data a backup must bring back (#349), written and read through the engine contract inside the installed web
# container: a rule in an Agent's SOUL.md and each Company's knowledge live only in the Engine's volume, not in the
# database, so the backup area writes them before its archive and reads them back after the restore.
lifecycle() { ENGINE_KEY=$(first_engine_key) compose exec -T -e ENGINE_KEY web node --input-type=module - "$1" < scripts/check-install.mjs; }
# Each Engine is its own Compose project (ADR 0018), so removing the install removes every one of them: the first
# Engine, every Company's Engine under .engines/, and the one container a release before #385 ran an Engine in.
remove_engine() {
  for folder in .engines/*/; do
    [ -f "$folder/.env" ] || continue
    name=$(sed -n 's/^ENGINE_NAME=//p' "$folder/.env")
    volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$folder/.env")
    network=$(sed -n 's/^ENGINE_NETWORK=//p' "$folder/.env")
    docker rm -f "$name" > /dev/null 2>&1 || true
    docker volume rm "$volume" > /dev/null 2>&1 || true
    docker network rm "$network" > /dev/null 2>&1 || true
  done
  docker rm -f gtmworks-engine-first > /dev/null 2>&1 || true
  docker volume rm gtmworks-install_hermes > /dev/null 2>&1 || true
  docker network rm gtmworks-engine-first > /dev/null 2>&1 || true
  docker rm -f gtmworks-install-hermes-1 > /dev/null 2>&1 || true
  rm -rf .engines
}
remove_install() { compose down -v && remove_engine; }
# An area starts on a fresh isolated Docker machine (#406): whatever an earlier area or an earlier run left there is
# removed first, settings and all, so an area never needs another one to have run and never carries its state.
reset_install() {
  if [ -f .env.install ]; then remove_install || return 1; else remove_engine; fi
  rm -f .env.install
}
publish() { docker push -q "localhost:5000/gtmworks:$1" > /dev/null && docker image inspect --format '{{index .RepoDigests 0}}' "localhost:5000/gtmworks:$1"; }
# The local registry a release area serves its test releases from: each area that needs one starts its own (#406).
start_registry() {
  docker rm -f install-registry > /dev/null 2>&1 || true
  docker run -d --name install-registry -p 127.0.0.1:5000:5000 registry:2.8.3 > /dev/null || fail 'local registry'
  for attempt in $(seq 1 30); do docker run --rm --network host curlimages/curl:8.12.1 -sf http://127.0.0.1:5000/v2/ > /dev/null && break; sleep 1; done
}
# This release and the next as registry images and release files, from the app image this checkout built (or CI loaded
# and tagged): the update and the one-line areas each make what they need from the same steps (#406).
publish_releases() {
  docker tag gtmworks-local:237 localhost:5000/gtmworks:0.0.0-ci || fail 'tag the built image'
  first=$(publish 0.0.0-ci) || fail 'push this release image'
  node scripts/release-assets.mjs "$first" release-first || fail 'this release files'
  docker build -q -t localhost:5000/gtmworks:0.0.1-ci - > /dev/null <<'DOCKERFILE' || fail 'build the next release image'
FROM localhost:5000/gtmworks:0.0.0-ci
RUN echo 'create table gtmworks_install.release_update_probe(id integer);' > /app/install/supabase/migrations/99999999999998_release_update_probe.sql
DOCKERFILE
  next=$(publish 0.0.1-ci) || fail 'push the next release image'
  node scripts/release-assets.mjs "$next" release-next || fail 'next release files'
}
web_image() { docker inspect -f '{{.Image}}' "$(compose ps -q web)"; }
probe() {
  for path in /api/health /sign-in; do
    status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request ($1)"
    echo "http://127.0.0.1:3000$path $status"
    [[ $status == 200 ]] || fail "$path returned HTTP $status $1 (expected 200)"
  done
}
