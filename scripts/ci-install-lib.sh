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
publish() { docker push -q "localhost:5000/gtmworks:$1" > /dev/null && docker image inspect --format '{{index .RepoDigests 0}}' "localhost:5000/gtmworks:$1"; }
web_image() { docker inspect -f '{{.Image}}' "$(compose ps -q web)"; }
probe() {
  for path in /api/health /sign-in; do
    status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request ($1)"
    echo "http://127.0.0.1:3000$path $status"
    [[ $status == 200 ]] || fail "$path returned HTTP $status $1 (expected 200)"
  done
}
