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
# An area starts from the proof's own sentence and the summary trap (#402, #411), so no area relies on what an earlier
# one set: the trap prints a fixed-field summary of the web and gateway logs (never log text) while the install still
# exists, and keeps the status. The job's last step removes the Docker machine; the update area turns the summary off,
# as the release and one-line steps never printed it.
# The rollback area's failing migration leaves the checkout. An update unpacks its source as root, so the folder may be
# root's by then and the file goes through a container.
remove_failing_migration() {
  rm -f supabase/migrations/99999999999999_failure.sql 2> /dev/null \
    || docker run --rm -v "$PWD/supabase/migrations:/migrations" alpine:3.21 rm -f /migrations/99999999999999_failure.sql
}
area_setup() {
  fail_prefix='install check failed: '
  # The rollback area's failing migration stays in the checkout when that area stops on a failed check: no later area
  # in the same checkout (./ci.sh install, all of them) applies it.
  remove_failing_migration
  trap 'status=$?; if [ "$status" -ne 0 ]; then bash scripts/install-diagnostics.sh || true; fi; exit "$status"' EXIT
}
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
# One value of an Engine's own file (.engines/<name>/.env): its container name, volume, network or key (#385). The
# folder is the Engine's own, with or without its trailing slash.
engine_value() { sed -n "s/^ENGINE_$2=//p" "$1/.env"; }
# The first Engine (ADR 0018): its addresses on the install network, the container that runs it, and the key in its own
# file, which is never in the install's environment (#385).
engine_address=http://gtmworks-engine-first:8642
engine_management=http://gtmworks-engine-first:9119
first_engine_id() { docker ps -q --filter 'name=^gtmworks-engine-first$'; }
first_engine_key() { engine_value .engines/first KEY 2> /dev/null || true; }
# A node check inside the installed web container against the first Engine's own addresses (ADR 0011), with that
# Engine's key in its environment by name: the addresses and the key the install keeps, written once for every area
# (#378, #408). The check is one of scripts/check-install-*.mjs, its input on stdin or in its argument.
engine_node() {
  ENGINE_KEY="$1" compose exec -T -e ENGINE_KEY -e HERMES_ADDRESS="$engine_address" \
    -e HERMES_MANAGEMENT_ADDRESS="$engine_management" web node --input-type=module "${@:2}"
}
# Wait, up to the given seconds, for the named Engine container to be healthy; the caller names the step it waited for
# (#382). Fails when it never is.
engine_healthy() {
  for attempt in $(seq 1 "$2"); do
    [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1") == healthy ]] && return 0
    sleep 1
  done
  return 1
}
# Every TCP port one Engine listens on, read from inside its own container: /proc/net/tcp and tcp6 list a listening socket
# as state 0A, with its port in hex after the last colon of the address (#393). The work-network check probes every one of
# them on the Engine's work-network address, so a listener that moves to the wildcard address is caught on any port.
engine_listen_ports() {
  docker exec "$1" sh -ec 'cat /proc/net/tcp /proc/net/tcp6 2> /dev/null || cat /proc/net/tcp 2> /dev/null || true' | while read -r _ address _ state _; do
    [ "${state:-}" = 0A ] || continue
    printf '%d\n' "$((16#${address##*:}))"
  done | sort -un | paste -sd, -
}
# The second Company on an Engine of its own, made by the command a person runs (#382): the caller names its failure and
# where the output goes; an area running a release's own installer names that script instead.
# Any argument after the installer's path is passed to `company add`, such as the sandbox limits (#396).
second_company() { sh "${1:-scripts/install.sh}" company add --name 'Second Company' --owner proxy-owner@example.com "${@:2}"; }
# The app image a source install runs, from its compose file's `web` service: CI loads the run's one build under this
# tag and the release areas tag their test releases from it, so a tag change is made in that file alone (#411).
web_image_tag() { sed -n '/^  web:$/,/^  [a-z]/s/^    image: //p' docker-compose.install.yml | head -n 1; }
# The data a backup must bring back (#349), written and read through the engine contract inside the installed web
# container: a rule in an Agent's SOUL.md and each Company's knowledge live only in the Engine's volume, not in the
# database, so the backup area writes them before its archive and reads them back after the restore.
lifecycle() { engine_node "$(first_engine_key)" - "$1" < scripts/check-install.mjs; }
# Each Engine is its own Compose project (ADR 0018), so removing the install removes every one of them: the first
# Engine, every Company's Engine under .engines/, and the one container a release before #385 ran an Engine in.
remove_engine() {
  for folder in .engines/*/; do
    [ -f "$folder/.env" ] || continue
    name=$(engine_value "$folder" NAME)
    volume=$(engine_value "$folder" VOLUME)
    network=$(engine_value "$folder" NETWORK)
    slug=${name#gtmworks-engine-}
    docker rm -f "$name" "gtmworks-sandbox-$slug" "gtmworks-exit-$slug" > /dev/null 2>&1 || true
    docker volume rm "$volume" "gtmworks-work-$slug" "gtmworks-sandbox-hostkey-$slug" > /dev/null 2>&1 || true
    docker network rm "$network" "gtmworks-work-$slug" "gtmworks-exit-$slug" > /dev/null 2>&1 || true
  done
  docker rm -f gtmworks-engine-first gtmworks-sandbox-first gtmworks-exit-first > /dev/null 2>&1 || true
  docker volume rm gtmworks-install_hermes gtmworks-work-first gtmworks-sandbox-hostkey-first > /dev/null 2>&1 || true
  docker network rm gtmworks-engine-first gtmworks-work-first gtmworks-exit-first > /dev/null 2>&1 || true
  docker rm -f gtmworks-install-hermes-1 > /dev/null 2>&1 || true
  remove_work_disks
  rm -rf .engines
}
# Every Company's work disk (#507), unmounted and deleted by the work sandbox image's own helper as the installer runs it,
# with its two volumes; its folder goes only once empty, so nothing on a disk still mounted is removed with it.
remove_work_disks() {
  local image folder
  image=$(cat .work-sandbox-image 2> /dev/null || echo gtmworks-work-sandbox:local)
  for folder in .work-disks/*/; do
    [[ -d $folder ]] || continue
    folder=${folder%/}
    docker volume rm "gtmworks-folder-${folder#.work-disks/}" "gtmworks-home-${folder#.work-disks/}" > /dev/null 2>&1 || true
    docker run --rm --privileged --pid host --network none --user 0 --entrypoint /usr/local/bin/work-disk \
      -v "$PWD/$folder:/disk" "$image" remove "$PWD/$folder" > /dev/null 2>&1 || true
    rmdir "$folder/fs" "$folder" 2> /dev/null || true
  done
  rmdir .work-disks 2> /dev/null || true
}
remove_install() { compose down -v && remove_engine; }
# An area starts on a fresh isolated Docker machine (#406): whatever an earlier area or an earlier run left there is
# removed first, settings and all, so an area never needs another one to have run and never carries its state.
reset_install() {
  # The release areas install a previous release in a folder of its own: one an earlier area left in the same checkout
  # (./ci.sh install, all of them, on one Docker machine) is taken down from that folder, with its volumes, first.
  for fixture in release-install stable-release-install sandbox-release-install staged-release-install rollback-release-install; do
    [ -f "$fixture/.env.install" ] || continue
    (cd "$fixture" && remove_install) || return 1
    rm -f "$fixture/.env.install" 2> /dev/null || docker run --rm -v "$PWD/$fixture:/fixture" alpine:3.21 rm -f /fixture/.env.install
  done
  if [ -f .env.install ]; then remove_install || return 1; else remove_engine; fi
  rm -f .env.install
}
# The setup an area starts from (#407, #408, #409): the source install, its output kept in the log named by the one
# argument and its status kept under the proof's pipefail, and first run completed the way a browser does it on the
# local install, straight to the gateway: the setup form's submission with the setup code in its body makes the first
# Company and signs its Owner in, the invitation and sign-in links stay on APP_ORIGIN, and no key or code is printed
# (issue #40, #50). first_install proves both steps, the repeat install still open between them; every other area runs
# them and carries on. The caller owns each failure sentence, so an area names the step it was in.
install_source() { sh scripts/install.sh 2>&1 | tee "$1"; }
complete_setup() {
  docker run --rm -i --network host --env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install) --env-file <(grep -E '^SETUP_CODE=' .env.install) \
    -e APP_ORIGIN=http://localhost:3000 -e MAIL_URL=http://127.0.0.1:8025 \
    node:22.14.0-alpine3.21 node --input-type=module - < scripts/check-install-proxy.mjs
}
# What an Agent was told, and the sign-in its Company made, written in an Engine's own data before an update (#385,
# #483): the code word $3 in the memory of profile $2 on the Engine container $1, and a Claude sign-in on that Engine.
# The release areas write them on the release they update and read them back after it (scripts/check-install-update.mjs).
# The Engine is running, so its SQLite journal comes and goes in the profile and a chown over all of it fails on a
# vanished file (#606): the profile folder alone and the memories folder written here change hands, nothing else in it.
tell_engine() {
  docker exec -i "$1" sh -ec \
    'mkdir -p "/opt/data/profiles/$1/memories"; printf "%s\n" "The company code word is $2." >> "/opt/data/profiles/$1/memories/MEMORY.md"; chown hermes:hermes "/opt/data/profiles/$1"; chown -R hermes:hermes "/opt/data/profiles/$1/memories"' \
    sh "$2" "$3"
}
sign_in_engine() {
  docker exec -i "$1" sh -ec \
    'umask 077; printf "%s\n" "{\"accessToken\":\"install-check-token\",\"refreshToken\":\"install-check-refresh\",\"expiresAt\":4102444800000}" > /opt/data/.anthropic_oauth.json; chown hermes:hermes /opt/data/.anthropic_oauth.json'
}
# A fake model provider served from the web container stands in for a subscription (#382, #408): companies and agents
# both point the first Engine at it, so an Arabic message gets its reply with no sign-in.
point_engine_at_fake_model() {
  docker exec -i "$1" sh -ec 'cat > /opt/data/config.yaml; chown hermes:hermes /opt/data/config.yaml' <<'YAML' || fail 'point the Engine at the fake model'
model:
  provider: custom
  default: fake-model
  base_url: http://web:8080/v1
  api_key: fake-model-key
  context_length: 128000
YAML
  docker restart "$1" > /dev/null || fail 'restart the Engine'
  engine_healthy "$1" 60 || fail 'the Engine is healthy after configuration'
}
# The registry's own digest is the one named: Docker's containerd image store also lists the digest of a local tag.
publish() { docker push -q "localhost:5000/gtmworks:$1" > /dev/null && docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "localhost:5000/gtmworks:$1" | grep -m 1 '^localhost:5000/gtmworks@'; }
# The work sandbox image the source install built (or CI loaded), pushed beside the app image so a release file pins it
# as the app image is pinned (#392, ADR 0020).
publish_sandbox() { docker push -q "localhost:5000/gtmworks-sandbox:$1" > /dev/null && docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "localhost:5000/gtmworks-sandbox:$1" | grep -m 1 '^localhost:5000/gtmworks-sandbox@'; }
# The fixed commits of main the release areas update from, each named once (#423). The release before the Engines (spec
# #378, C1): the update and previous-archive areas. The release before the work sandbox, the commit spec #389's branch
# last merged (#472): the sandbox-update and staged-update areas. Not origin/main or a pull request's base: once a spec
# merges, main has its shape, and the proof would update this release's own shape to itself.
previous_release_commit=8f47abe1761548a45de72937fac443a4bdea3eb6
before_sandbox_release_commit=a404785204c76ddf27ae8ea97c7c9b5b4ae73304
# The fixed commit an area updates from, or nothing for an area that builds no earlier release: CI keys the image it
# keeps on it (.github/workflows/ci.yml, the install job).
area_release_commit() {
  case "$1" in
    update | previous-archive) printf '%s' "$previous_release_commit";;
    sandbox-update | staged-update) printf '%s' "$before_sandbox_release_commit";;
  esac
}
# A fixed commit's image, built from its checkout ($3, with any build arguments after it) and tagged $2. Its image is the
# same on every run, so with GTMWORKS_RELEASE_IMAGES set (CI, a folder the Actions cache keeps per commit) the first build
# is saved there and every later run loads it instead of building it again (#423); `./ci.sh install` sets nothing and
# builds it.
release_image() {
  local commit=$1 tag=$2 source=$3 kept=''
  shift 3
  [[ -n ${GTMWORKS_RELEASE_IMAGES:-} ]] && kept="$GTMWORKS_RELEASE_IMAGES/$commit.tar"
  # A kept archive that does not load (a cut-off save) is built again, as if none were kept.
  if ! { [[ -n $kept && -f $kept ]] && docker load -q -i "$kept" > /dev/null; }; then
    bash scripts/docker-build.sh -q "$@" -t "gtmworks-release:$commit" "$source" > /dev/null || return 1
    if [[ -n $kept ]]; then mkdir -p "$GTMWORKS_RELEASE_IMAGES" && docker save -o "$kept" "gtmworks-release:$commit" || return 1; fi
  fi
  docker tag "gtmworks-release:$commit" "$tag"
}
# The local registry a release area serves its test releases from: each area that needs one starts its own (#406).
start_registry() {
  docker rm -f install-registry > /dev/null 2>&1 || true
  docker run -d --name install-registry -p 127.0.0.1:5000:5000 registry:2.8.3 > /dev/null || fail 'local registry'
  for attempt in $(seq 1 30); do docker run --rm --network host curlimages/curl:8.12.1 -sf http://127.0.0.1:5000/v2/ > /dev/null && break; sleep 1; done
}
# This release and the next as registry images and release files, from the app image this checkout built (or CI loaded
# and tagged): the update and the one-line areas each make what they need from the same steps (#406).
publish_releases() {
  # CI loads the run's one app and sandbox image (GTMWORKS_IMAGE_PREBUILT); on a fresh Docker machine an area that makes
  # its releases before it installs anything builds them from the checkout first, as a source install would.
  if [[ ${GTMWORKS_IMAGE_PREBUILT:-} != true ]]; then
    docker image inspect "$(web_image_tag)" > /dev/null 2>&1 || bash scripts/docker-build.sh -q -t "$(web_image_tag)" . > /dev/null || fail 'build this release image'
    docker image inspect gtmworks-work-sandbox:local > /dev/null 2>&1 || docker build -q -t gtmworks-work-sandbox:local sandbox > /dev/null || fail 'build the work sandbox image'
  fi
  docker tag "$(web_image_tag)" localhost:5000/gtmworks:0.0.0-ci || fail 'tag the built image'
  first=$(publish 0.0.0-ci) || fail 'push this release image'
  # Every release file below pins the work sandbox image too (#392); `sandbox` stays set for the area's later releases.
  # The tag a source install builds the image under, which CI also loads it under (scripts/install.sh work_sandbox_tag):
  # an area may make its releases before it installs anything.
  docker tag gtmworks-work-sandbox:local localhost:5000/gtmworks-sandbox:0.0.0-ci || fail 'tag the work sandbox image'
  sandbox=$(publish_sandbox 0.0.0-ci) || fail 'push the work sandbox image'
  node scripts/release-assets.mjs "$first" release-first "$sandbox" || fail 'this release files'
  docker build -q -t localhost:5000/gtmworks:0.0.1-ci - > /dev/null <<'DOCKERFILE' || fail 'build the next release image'
FROM localhost:5000/gtmworks:0.0.0-ci
RUN echo 'create table gtmworks_install.release_update_probe(id integer);' > /app/install/supabase/migrations/99999999999998_release_update_probe.sql
DOCKERFILE
  next=$(publish 0.0.1-ci) || fail 'push the next release image'
  node scripts/release-assets.mjs "$next" release-next "$sandbox" || fail 'next release files'
}
# A release whose work sandbox does not start, as release-broken-sandbox files: this release with a sandbox image that
# exits at once (broken_sandbox). The staged-update and sandbox-rollback areas update to it (#504); publish_releases runs
# first.
publish_broken_sandbox_release() {
  docker build -q -t localhost:5000/gtmworks-sandbox:0.0.3-broken - > /dev/null <<DOCKERFILE || fail 'build a work sandbox image that does not start'
FROM $sandbox
ENTRYPOINT ["sh","-c","echo this work sandbox does not start >&2; exit 1"]
DOCKERFILE
  broken_sandbox=$(publish_sandbox 0.0.3-broken) || fail 'push the work sandbox image that does not start'
  ( cd "$root" && node scripts/release-assets.mjs "$first" release-broken-sandbox "$broken_sandbox" ) || fail 'the release files whose work sandbox does not start'
}
# A release whose Engine does not start, as release-broken-engine files: this release with an Engine image that holds no
# Hermes. The staged-update area updates the release before the work sandbox to it, and the update area the release
# before the Engines (#502); publish_releases runs first.
publish_broken_engine_release() {
  docker image inspect alpine:3.21 > /dev/null 2>&1 || docker pull -q alpine:3.21 > /dev/null || fail 'pull the image the Engine that does not start is made of'
  docker tag alpine:3.21 gtmworks-engine-broken:0.0.4 || fail 'tag an Engine image that does not start'
  docker build -q -t localhost:5000/gtmworks:0.0.4-broken-engine - > /dev/null <<'DOCKERFILE' || fail 'build the release whose Engine does not start'
FROM localhost:5000/gtmworks:0.0.0-ci
RUN sed -i '0,/^\( *image:\).*/s//\1 gtmworks-engine-broken:0.0.4/' /app/install/scripts/engine-template.yml
DOCKERFILE
  broken_engine=$(publish 0.0.4-broken-engine) || fail 'push the release whose Engine does not start'
  ( cd "$root" && node scripts/release-assets.mjs "$broken_engine" release-broken-engine "$sandbox" ) || fail 'the release files whose Engine does not start'
}
# Every file of an install belongs to the user who ran it. Only a Docker whose `--user $(id -u)` is that same user can show
# it: ./ci.sh install, whose Docker machine sits inside rootless Docker, sets INSTALL_LANE_FOREIGN_OWNER and the check is
# left to CI.
owned_by_others() {
  if [[ -n ${INSTALL_LANE_FOREIGN_OWNER:-} ]]; then echo "file owners not checked here (INSTALL_LANE_FOREIGN_OWNER)" >&2; return 0; fi
  # A mounted work disk (#507) is a filesystem of its own, whose files (its root, at fs/, included) are the Company's
  # sandbox user's: not looked into.
  find "$1" -xdev ! -user "$(id -u)" ! -path '*/.work-disks/*/fs'
}
web_image() { docker inspect -f '{{.Image}}' "$(compose ps -q web)"; }
# The public half of the key an Engine dials its Company's sandbox with (#393): read from the Engine's own data volume in a
# throwaway container of the sandbox image, as root because the key belongs to the Engine's user (uid 10000).
sandbox_public_of() { docker run --rm --user 0 --entrypoint sh -v "$1:/data:ro" "$(cat .work-sandbox-image)" -ec 'ssh-keygen -y -f /data/ssh/id_ed25519'; }
# One Engine's own work network, derived from its container name, and its sandbox name.
work_network_of() { printf '%s' "$1" | sed 's/^gtmworks-engine-/gtmworks-work-/'; }
sandbox_of() { printf '%s' "$1" | sed 's/^gtmworks-engine-/gtmworks-sandbox-/'; }
probe() {
  for path in /api/health /sign-in; do
    status=$(docker run --rm --network host curlimages/curl:8.12.1 -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path") || fail "$path request ($1)"
    echo "http://127.0.0.1:3000$path $status"
    [[ $status == 200 ]] || fail "$path returned HTTP $status $1 (expected 200)"
  done
}
# One Engine's Company's exit (#394), derived from the Engine's container name as its sandbox is.
exit_of() { printf '%s' "$1" | sed 's/^gtmworks-engine-/gtmworks-exit-/'; }
# Whether a container publishes a port on the host (#540): true for any real binding, in its running ports or in the ones
# it asked for, never for a port it only exposes; Docker 29 lists that one with a null binding where Docker 28 listed
# none, so a count of its ports is no answer. A container it cannot read counts as publishing, so a check fails closed.
publishes_host_port() {
  local bindings
  bindings=$(docker inspect -f '{{json .NetworkSettings.Ports}} {{json .HostConfig.PortBindings}}' "$1") || return 0
  [[ $bindings == *'"HostPort"'* ]]
}
# Whether an Engine holds the release's managed configuration (ADR 0018, #871): the release's own file, mounted read-only,
# from which Hermes reads the work sandbox's terminal backend and the tools no Agent gets, whatever a profile or the
# Owner's Hermes dashboard wrote. The file is the one beside the template in scripts/ (or the one named second). And its
# managed environment (#893), which holds the file tools' write root: the Engine refuses to save it into any profile.
engine_pinned() {
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/hermes/config.yaml"}}{{.RW}}{{end}}{{end}}' "$1") == false ]] || return 1
  docker exec "$1" cat /etc/hermes/config.yaml | cmp -s - "${2:-scripts/engine-managed.yml}" || return 1
  [[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/hermes/.env"}}{{.RW}}{{end}}{{end}}' "$1") == false ]] || return 1
  docker exec "$1" cat /etc/hermes/.env | cmp -s - scripts/engine-managed.env || return 1
  docker exec -u hermes -e HERMES_HOME=/opt/data "$1" /opt/hermes/.venv/bin/python -c 'import sys
from hermes_cli.config import env_write_refusal
sys.exit(0 if env_write_refusal("HERMES_WRITE_SAFE_ROOT", "set") else 1)' || return 1
  docker exec -u hermes -e HERMES_HOME=/opt/data "$1" /opt/hermes/.venv/bin/python -c 'import sys
from hermes_cli.config import load_config
config = load_config()
sys.exit(0 if config["terminal"]["backend"] == "ssh" and set(sys.argv[1:]) <= set(config["agent"]["disabled_toolsets"]) else 1)' \
    browser tts video video_gen project desktop_ui catalog onboarding kanban connections
}
# Every address a container has, on every network it joins, comma-separated.
addresses_of() { docker inspect -f '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' "$1" | grep . | paste -sd, -; }
# The sandbox exit proof (scripts/check-install-sandbox-exit.mjs) run inside a Company's sandbox the way an Agent's
# command runs there: over the Engine's own ssh login, with the Engine's key and the host key its known_hosts pins, so the
# environment it sees is the one every session of that Engine gets. The one argument is the proof's base64 JSON.
sandbox_exit_probe() {
  docker exec -i -u hermes "$1" ssh -i /opt/data/ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile=/opt/data/.ssh/known_hosts -o LogLevel=ERROR -p 2222 pn@sandbox \
    node --input-type=module - "$2" < scripts/check-install-sandbox-exit.mjs
}
# The install's default RAM and CPU for one sandbox, read from the one place they are set, the sandbox service of
# scripts/engine-template.yml (#400): `sandbox_default mem_limit` prints its memory (as Compose reads it, e.g. 2g) and
# `sandbox_default cpus` its CPUs. sandbox_memory_bytes and sandbox_nano_cpus give the values `docker inspect` reports.
sandbox_default() { sed -n "/^  sandbox:$/,/^  [a-z]/s/^    $1: \${SANDBOX_[A-Z]*:-\(.*\)}$/\1/p" scripts/engine-template.yml; }
sandbox_memory_bytes() {
  memory=$(sandbox_default mem_limit)
  case $memory in
    *g) echo $(( ${memory%g} * 1073741824 ));;
    *m) echo $(( ${memory%m} * 1048576 ));;
    *) return 1;;
  esac
}
sandbox_nano_cpus() { awk -v cpus="$(sandbox_default cpus)" 'BEGIN { printf "%d\n", cpus * 1000000000 }'; }
