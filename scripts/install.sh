#!/bin/sh
set +x
set -eu
# Read the function before an update replaces this script on disk.
main() {
# A release's install script names its image by digest (scripts/release-assets.mjs) and sits beside its compose file;
# in a source checkout this stays empty and the image is built from the checkout. The work sandbox image every Company's
# sandbox runs (#392, ADR 0020) is named the same way: a release's pinned one, or one this checkout builds.
release_image=
sandbox_image=
if [ -n "$release_image" ]; then cd "$(dirname "$0")"; else cd "$(dirname "$0")/.."; fi
umask 077
# One install at a time, held on a file descriptor of .install.lock: the kernel releases it when this process ends,
# however it ends, so a lock file left by an install that was killed is held by no one and never blocks the next run,
# and an install that is still running keeps it, so it is never taken over. `.install-lock/` is this run's scratch
# folder, made under the lock and removed on exit; the lock file itself is never removed, so every run opens the same one.
command -v flock > /dev/null 2>&1 || {
  echo 'The installer needs flock to run one install at a time. It comes with util-linux, which nearly every Linux install has; install it, then run this again.' >&2
  exit 1
}
exec 9>.install.lock
flock -n 9 || { echo 'Another install is running: wait for it to finish, then run this again.' >&2; exit 1; }
# shortcut: an installer from before #67 locks with the folder and its owner file, not flock; while one still runs it keeps
# its folder. Remove this once no install can still run a pre-#67 installer.
old_pid=; if [ -f .install-lock/owner ]; then read -r _ old_pid _ < .install-lock/owner || true; fi
case "$old_pid" in ''|*[!0-9]*) ;; *) if kill -0 "$old_pid" 2> /dev/null; then echo 'Another install is running (or remove stale .install-lock).' >&2; exit 1; fi;; esac
rm -rf .install-lock
mkdir .install-lock
resume=no
worker_stopped=no
cleanup() {
  status=$?
  trap - EXIT
  # Only an install that had an Engine folder before this run starts its Engines again: a run that refused, or a backup of
  # an install the previous release made, must never write .engines/first/.env itself (#378, C13).
  if [ "$resume" = yes ]; then compose up -d --wait --wait-timeout 300 || status=1; if [ -f "$(engine_folder first)/.env" ]; then engines_up || status=1; fi; fi
  # A run that stopped the worker for a gateway change and failed before the app started leaves it running again.
  if [ "$worker_stopped" = yes ]; then compose start worker || status=1; fi
  rm -f .env.install.tmp
  rm -rf .install-lock
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
node_image=node:22.14.0-alpine3.21
compose() { docker compose --env-file .env.install -f docker-compose.install.yml "$@"; }
# The image every Company's work sandbox runs (#392, ADR 0020): a release names it by tag and digest and the install
# pulls it; a source checkout builds it from its one build file. Its reference is written under .install-lock while the
# run is in flight and only moved to .work-sandbox-image when the run succeeds (#393), so a run that failed records no
# image it did not finish with. Every sandbox of an install reads that one file.
work_sandbox_tag=gtmworks-work-sandbox:local
work_sandbox_image() {
  if [ -n "$sandbox_image" ]; then
    echo "Pulling the work sandbox image: $sandbox_image"
    docker pull "$sandbox_image" || return 1
    printf '%s\n' "$sandbox_image" > .install-lock/work-sandbox-image
  else
    # Tests only (#401): CI's install areas load the run's one sandbox image under this tag, as they load the app image.
    if [ "${GTMWORKS_IMAGE_PREBUILT:-}" = true ] && docker image inspect "$work_sandbox_tag" > /dev/null 2>&1; then
      echo "Using the prebuilt work sandbox image (GTMWORKS_IMAGE_PREBUILT=true): $work_sandbox_tag"
    else
      echo "Building the work sandbox image: $work_sandbox_tag"
      docker build --tag "$work_sandbox_tag" sandbox || return 1
    fi
    printf '%s\n' "$work_sandbox_tag" > .install-lock/work-sandbox-image
  fi
}
# The image a sandbox may start from now: the one this run made, or the one an earlier successful run recorded. It never
# builds or pulls anything: the exit handler starts Engines after a run that failed, and must not start a build there.
work_sandbox_ref() { cat .install-lock/work-sandbox-image 2> /dev/null || cat .work-sandbox-image 2> /dev/null; }
# A Company's Engine (ADR 0018) is made from the template shipped with the release, as its own Compose project: the pinned
# official Hermes image, its own data volume, its own key and its own network. The app and the worker join that network;
# the Engine joins nothing else. The installer makes the first Company's Engine; `gtmworks company add` (#382, #383) makes
# a later Company's the same way, one folder under .engines/<slug>, and holds an unnamed Owner's Company behind a
# first-Owner link. An install made before ADR 0018 keeps its existing
# `hermes` volume, now under the first Engine's name, so its Agents' memory, Skills and history stay.
engine_template=scripts/engine-template.yml
engine_address=http://gtmworks-engine-first:8642
engine_management=http://gtmworks-engine-first:9119
engine_volume=gtmworks-install_hermes
engine_project() { printf 'gtmworks-engine-%s' "$1"; }
engine_folder() { printf '.engines/%s' "$1"; }
# The work sandbox each Engine works through (#393, ADR 0018): its container, the Company's work folder volume, its own
# network and the small volume its host key is kept in. Every name comes from the Engine's folder, as its Engine's names
# do, so a restore needs no other record; none begins with `gtmworks-engine`, so the Engine counts stay what they were.
sandbox_container() { printf 'gtmworks-sandbox-%s' "$1"; }
# The sandbox's exit (#394): its container and the one network of the Company's that routes out.
exit_container() { printf 'gtmworks-exit-%s' "$1"; }
exit_network() { printf 'gtmworks-exit-%s' "$1"; }
work_volume() { printf 'gtmworks-work-%s' "$1"; }
work_network() { printf 'gtmworks-work-%s' "$1"; }
host_key_volume() { printf 'gtmworks-sandbox-hostkey-%s' "$1"; }
# What one sandbox gets by default, in one place: the RAM and CPU the install gives a Company's sandbox, and the process
# limit and shared memory it needs for Chromium. #400 replaces the memory figure from its measurement; a person can
# raise any of them in the environment of the install's own command.
sandbox_memory=${SANDBOX_MEMORY:-2g}
sandbox_cpus=${SANDBOX_CPUS:-2.0}
sandbox_pids=${SANDBOX_PIDS:-2048}
sandbox_shm=${SANDBOX_SHM:-1gb}
# The private key an Engine dials its sandbox with, and the sandbox's own host key, both made in the one sandbox image
# (it has ssh-keygen; the Engine has none) and written into the Engine's data volume and the host-key volume. The Engine's
# known_hosts is written to the host key's public half at the address its ssh client uses, so a recreated sandbox keeps
# the host key its Engine trusts. The deviation from a pinned known_hosts: Hermes's ssh client is hard-coded
# StrictHostKeyChecking=accept-new (tools/environments/ssh.py), so gtmworks cannot demand a known host; it pre-seeds the
# Engine's file instead, and accept-new still refuses a host whose key changed. The public key is printed for the Compose
# environment and never written to a file of the install.
sandbox_keys() {
  slug=$1
  folder=$(engine_folder "$slug")
  volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$folder/.env")
  test -n "$volume" || { echo "The Engine $slug names no data volume: run sh scripts/install.sh." >&2; return 1; }
  # An Engine the exit handler starts after a run that failed before the image was recorded (a failed update, a backup)
  # starts only from an image an earlier run recorded: this never builds or pulls one from the exit handler (#393).
  image=$(work_sandbox_ref)
  test -n "$image" || { echo "The work sandbox image is not recorded: run sh scripts/install.sh." >&2; return 1; }
  docker volume create "$volume" > /dev/null || return 1
  docker volume create "$(host_key_volume "$slug")" > /dev/null || return 1
  keys=$(docker run --rm --user 0 --entrypoint sh -v "$volume:/data" -v "$(host_key_volume "$slug"):/keys" \
    "$image" -ec '
      set -e
      install -d -m 700 -o 10000 -g 10000 /data/ssh
      if [ ! -s /data/ssh/id_ed25519 ]; then
        ssh-keygen -q -t ed25519 -N "" -C "gtmworks-work-sandbox" -f /data/ssh/id_ed25519
      else
        ssh-keygen -y -f /data/ssh/id_ed25519 > /data/ssh/id_ed25519.pub
      fi
      chown 10000:10000 /data/ssh/id_ed25519 /data/ssh/id_ed25519.pub
      chmod 600 /data/ssh/id_ed25519
      chmod 644 /data/ssh/id_ed25519.pub
      if [ ! -s /keys/ssh_host_ed25519_key ]; then
        ssh-keygen -q -t ed25519 -N "" -C "gtmworks-work-sandbox-host" -f /keys/ssh_host_ed25519_key
      else
        ssh-keygen -y -f /keys/ssh_host_ed25519_key > /keys/ssh_host_ed25519_key.pub
      fi
      chown 1000:1000 /keys/ssh_host_ed25519_key /keys/ssh_host_ed25519_key.pub
      chmod 600 /keys/ssh_host_ed25519_key
      chmod 644 /keys/ssh_host_ed25519_key.pub
      install -d -m 700 -o 10000 -g 10000 /data/.ssh
      { grep -v "^\[sandbox\]:2222 " /data/.ssh/known_hosts 2> /dev/null || true; printf "[sandbox]:2222 %s\n" "$(cat /keys/ssh_host_ed25519_key.pub)"; } > /data/.ssh/known_hosts
      chown 10000:10000 /data/.ssh/known_hosts
      chmod 600 /data/.ssh/known_hosts
      printf "client %s\n" "$(cat /data/ssh/id_ed25519.pub)"
      printf "host %s\n" "$(cat /keys/ssh_host_ed25519_key.pub)"
    ') || return 1
  sandbox_key=$(printf '%s\n' "$keys" | sed -n 's/^client //p')
  sandbox_host_key=$(printf '%s\n' "$keys" | sed -n 's/^host //p')
  test -n "$sandbox_key" && test -n "$sandbox_host_key" \
    || { echo "The work sandbox keys of the Engine $slug could not be made." >&2; return 1; }
}
# Every Engine the install has, one folder each under .engines: the first Engine and every Company's own. A backup, a
# restore and a stop cover each of them (#386); a folder with no .env is not an Engine.
engine_names() {
  for folder in .engines/*/; do
    [ -f "$folder/.env" ] || continue
    name=${folder#.engines/}
    printf '%s\n' "${name%/}"
  done
}
# The sandbox's names, image and limits reach Compose in its environment only, never in .env.install or the Engine's own
# file: the names are derived from the folder above, so a restore needs no second record, and the public key that
# belongs to this Engine's private key is passed here.
engine() {
  slug=$1
  shift
  SANDBOX_IMAGE=${SANDBOX_IMAGE:-$(work_sandbox_ref || printf '%s' "$work_sandbox_tag")} \
  SANDBOX_NAME=$(sandbox_container "$slug") \
  SANDBOX_AUTHORIZED_KEY=${sandbox_key:-} \
  SANDBOX_HOST_KEY_VOLUME=$(host_key_volume "$slug") \
  SANDBOX_MEMORY=${SANDBOX_MEMORY:-$sandbox_memory} \
  SANDBOX_CPUS=${SANDBOX_CPUS:-$sandbox_cpus} \
  SANDBOX_PIDS=${SANDBOX_PIDS:-$sandbox_pids} \
  SANDBOX_SHM=${SANDBOX_SHM:-$sandbox_shm} \
  WORK_VOLUME=$(work_volume "$slug") \
  WORK_NETWORK=$(work_network "$slug") \
  EXIT_NAME=$(exit_container "$slug") \
  EXIT_NETWORK=$(exit_network "$slug") \
  docker compose --project-name "$(engine_project "$slug")" --env-file "$(engine_folder "$slug")/.env" -f "$engine_template" "$@"
}
# An Engine's key lives in its own file, never in .env.install, the file the app and the worker read their environment
# from (#385, ADR 0018). A fresh install makes the first Engine's; an install the previous release made keeps the key it
# has, moved here unchanged, so the Engine that already holds the Company's Agents, memory, Skills, history and sign-in
# keeps answering.
engine_key() {
  file="$(engine_folder "${1:-first}")/.env"
  test -f "$file" || return 0
  sed -n 's/^ENGINE_KEY=//p' "$file"
}
adopt_engine_key() {
  key=$(engine_key first)
  if [ -z "$key" ]; then key=$(sed -n 's/^HERMES_API_KEY=//p' .env.install); fi
  if [ -z "$key" ]; then
    key=$(docker run --rm -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs engine-key) || return 1
  fi
  test -n "$key" || { echo 'Could not make an Engine key: run sh scripts/install.sh.' >&2; return 1; }
  # The Engine's own file is written and in place before the install's file loses its HERMES_API_KEY line (#378, C7): a
  # write that fails leaves the install exactly as it was, with its key still where it was.
  write_engine_env first "$key" "$engine_volume" "$(engine_project first)" || return 1
  drop_install_env_key || return 1
}
# No Engine key sits in .env.install. An install made before ADR 0018 kept it there; its line goes as the key moves into
# the Engine's own file, and nothing else in the file changes.
drop_install_env_key() {
  grep -q '^HERMES_API_KEY=' .env.install || return 0
  sed '/^HERMES_API_KEY=/d' .env.install > .install-lock/env.tmp || return 1
  chmod 600 .install-lock/env.tmp || return 1
  mv .install-lock/env.tmp .env.install || return 1
}
# One Engine's own file, written the moment it is complete (#378, C7): under a temporary name, owner-only, then moved into
# place, so a run ended in the middle of it leaves no half file and no Engine without the key it was given.
write_engine_env() {
  slug=$1 key=$2 volume=$3 network=$4
  folder=$(engine_folder "$slug")
  mkdir -p "$folder" || return 1
  {
    printf 'ENGINE_NAME=%s\n' "$(engine_project "$slug")" &&
    printf 'ENGINE_KEY=%s\n' "$key" &&
    printf 'ENGINE_VOLUME=%s\n' "$volume" &&
    printf 'ENGINE_NETWORK=%s\n' "$network"
  } > "$folder/.env.tmp" || return 1
  chmod 600 "$folder/.env.tmp" || return 1
  mv "$folder/.env.tmp" "$folder/.env" || return 1
}
# A container from the one-Hermes install (before ADR 0018) is not part of this compose file any more. It must stop
# before the Engine template uses the same volume, and its volume is the first Engine's data.
retire_old_engine() {
  old=$(docker ps -aq --filter 'label=com.docker.compose.project=gtmworks-install' \
    --filter 'label=com.docker.compose.service=hermes') || return 1
  [ -z "$old" ] || docker rm -f $old > /dev/null
}
# The app and the worker reach every Engine by its container name. Compose recreates them on an update, which drops the
# extra networks, so each connection is made again after every start of the stack. The app answers on each Engine's
# network as `web`, the name its own scripts use there (`http://web:8080/v1`), so a probe or a model server on that
# network reaches it without a second address; the worker needs no name there. An install made before this name keeps
# its connection and joins again with it.
join_engine_network() {
  network=$1
  test -n "$network" || return 0
  for service in web worker; do
    id=$(compose ps -q "$service") || return 1
    [ -n "$id" ] || continue
    container_name=$(docker inspect -f '{{.Name}}' "$id") || return 1
    container_name=${container_name#/}
    alias=
    [ "$service" = web ] && alias=web
    if docker network inspect "$network" -f '{{range .Containers}}{{println .Name}}{{end}}' | grep -qx "$container_name"; then
      [ -z "$alias" ] && continue
      docker inspect -f "{{range \$network,\$settings := .NetworkSettings.Networks}}{{if eq \$network \"$network\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}{{end}}" "$id" \
        | grep -qx "$alias" && continue
      docker network disconnect "$network" "$id" || return 1
    fi
    if [ -n "$alias" ]; then
      docker network connect --alias "$alias" "$network" "$id" || return 1
    else
      docker network connect "$network" "$id" || return 1
    fi
  done
}
engine_network_of() { sed -n 's/^ENGINE_NETWORK=//p' "$(engine_folder "$1")/.env"; }
join_engine_networks() {
  for name in $(engine_names); do
    join_engine_network "$(engine_network_of "$name")" || return 1
  done
}
# An Engine counts as started only once its container reports healthy. Compose's --wait is not trusted alone: some Compose
# releases end it at the timeout with success while the Engine is still starting.
engine_start() {
  wait=${GTMWORKS_ENGINE_WAIT:-300}
  # The Engine's own key pair and its sandbox's host key are made or read before anything starts, so the sandbox it
  # starts with accepts exactly this Engine and its known_hosts already trusts the host key it will meet.
  sandbox_keys "$1" || return 1
  engine "$1" up -d --wait --wait-timeout "$wait" || return 1
  container=$(engine_project "$1")
  while [ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2> /dev/null)" != healthy ]; do
    wait=$((wait-1))
    [ "$wait" -gt 0 ] || { echo "The Engine $container did not become healthy." >&2; return 1; }
    sleep 1
  done
}
# One Engine stopped and removed with everything it made. Its folder and record go too; a record's removal is the caller's
# (it needs the database) and only ever a record no Company names.
engine_destroy() {
  slug=$1 volume=$2 network=$3
  engine "$slug" down -v --remove-orphans > /dev/null 2>&1 || true
  docker rm -f "$(engine_project "$slug")" "$(sandbox_container "$slug")" "$(exit_container "$slug")" > /dev/null 2>&1 || true
  docker volume rm "$volume" "$(work_volume "$slug")" "$(host_key_volume "$slug")" > /dev/null 2>&1 || true
  docker network rm "$(work_network "$slug")" "$(exit_network "$slug")" > /dev/null 2>&1 || true
  # The app and the worker may have joined this Engine's network before a later step failed: detach them first, or the
  # network would be left behind and the same command run again would meet it.
  for service in web worker; do
    id=$(compose ps -q "$service" 2> /dev/null || true)
    [ -z "$id" ] || docker network disconnect -f "$network" "$id" > /dev/null 2>&1 || true
  done
  docker network rm "$network" > /dev/null 2>&1 || true
  rm -rf "$(engine_folder "$slug")"
}
first_engine_up() {
  adopt_engine_key || return 1
  key=$(engine_key)
  test -n "$key" || { echo 'The install has no Engine key: run sh scripts/install.sh.' >&2; return 1; }
  retire_old_engine || return 1
  engine_start first || return 1
  join_engine_network gtmworks-engine-first
}
# Every Engine the install has, the first one included: an update starts each from its own folder after the release's
# template replaced the one on disk, so a release that pins another Engine image recreates every Company's Engine with
# its data volume, its key and its network, and no Company is left on an old Engine (#386). One Engine that does not start
# does not hide the others (#378, C8): every Engine is tried, the app and the worker join the network of each that
# started, and the run fails if any did not.
engines_up() {
  failed=0
  if ! first_engine_up; then
    echo "The Engine $(engine_project first) did not start." >&2
    failed=1
  fi
  for name in $(engine_names); do
    [ "$name" != first ] || continue
    if engine_start "$name"; then
      join_engine_network "$(engine_network_of "$name")" || failed=1
    else
      echo "The Engine $(engine_project "$name") did not start." >&2
      failed=1
    fi
  done
  [ "$failed" -eq 0 ]
}
# Every Engine stopped before its data volume is copied: a live Engine writes under its volume while the archive reads
# it, and a restore replaces what is in it (#386). An install the previous release made has no .engines/first until its
# key is adopted; its one Engine is the first one.
engine_stop() {
  for name in $(engine_names); do
    docker stop "$(engine_project "$name")" > /dev/null 2>&1 || true
  done
  [ -f "$(engine_folder first)/.env" ] || docker stop "$(engine_project first)" > /dev/null 2>&1 || true
}
# A stop Docker did not carry out is named, and the backup stops before it copies a volume a live Engine still writes to
# (#378, C9). What was stopped starts again from the exit handler, and no archive is written.
engines_stopped() {
  running=
  for name in $(engine_names); do
    container=$(engine_project "$name")
    # A container Docker does not list is stopped; one it lists but cannot report on is not known to be stopped.
    listed=$(docker ps -aq --filter "name=^${container}$" 2> /dev/null) || { running="$running $container"; continue; }
    [ -n "$listed" ] || continue
    state=$(docker inspect -f '{{.State.Running}}' "$container" 2> /dev/null) || state=unknown
    [ "$state" = false ] || running="$running $container"
  done
  [ -z "$running" ] || {
    echo "This Engine did not stop:$running. Nothing was archived, and what was stopped starts again." >&2
    return 1
  }
}
# An install the previous release made runs its one Engine in a `hermes` container of the install project and has no
# Engine folder (#385): this release's backup would take no Engine data and its restore would take the Engine away, so
# both refuse before stopping anything and name the update that moves the Engine into its own container first
# (#378, C6).
previous_release_engine() {
  [ ! -f "$(engine_folder first)/.env" ] || return 1
  old=$(docker ps -aq --filter 'label=com.docker.compose.project=gtmworks-install' \
    --filter 'label=com.docker.compose.service=hermes' 2> /dev/null) || return 1
  [ -n "$old" ]
}
refuse_previous_release_engine() {
  previous_release_engine || return 0
  echo 'This install still runs the Engine the previous release made. Run sh install.sh update first, then run this again.' >&2
  return 1
}
# A new Engine's key: 64 hex characters, the shape the install's own key has, generated here and kept in the Engine's own
# folder file (owner-only) and encrypted in its record. It is never printed.
new_engine_key() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
# `gtmworks sign-in claude --company <id-or-name>` (#384, ADR 0018): Claude's sign-in is the Engine's own, run in that
# Company's Engine on its root profile, which lends it to every Agent of the Company. The Engine's address in the record
# names its container (scripts/engine-template.yml), so the command runs in that container only; an address whose whole
# value is not an Engine of this install is refused. The sign-in asks for a pasted code, so stdin stays open.
sign_in() {
  provider=${1:-}
  shift || true
  company_name=
  while [ $# -gt 0 ]; do
    case "$1" in --company) [ $# -ge 2 ] || break; company_name=$2; shift;; esac
    shift
  done
  [ "$provider" = claude ] || { echo 'gtmworks sign-in signs in claude.' >&2; return 1; }
  test -n "$company_name" || { echo 'gtmworks sign-in claude needs --company <id-or-name>.' >&2; return 1; }
  test -f .env.install || { echo 'Install first.' >&2; return 1; }
  rows=$(printf '%s\n' "select e.address,c.name from public.companies c join public.company_engines e on e.id=c.engine_id where c.id::text=:'company' or lower(c.name)=lower(:'company') order by c.id limit 2;" \
    | compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -v company="$company_name") \
    || { echo "Could not read this install's Companies: is gtmworks running? See gtmworks status." >&2; return 1; }
  count=$(printf '%s\n' "$rows" | grep -c . || true)
  [ "$count" -ne 0 ] || { echo "No Company in this install is named $company_name. Pass the Company's id or its exact name." >&2; return 1; }
  [ "$count" -eq 1 ] || { echo "More than one Company in this install is named $company_name. Pass the Company's id instead." >&2; return 1; }
  address=${rows%%|*} name=${rows#*|}
  printf '%s\n' "$address" | grep -Eq '^http://gtmworks-engine-[a-z0-9-]+:8642$' \
    || { echo "The Engine record of $name names no Engine of this install. Nothing was changed." >&2; return 1; }
  host=${address#*://} host=${host%%:*}
  echo "Signing $name in to Claude on its Engine: $host. One account serves one Company."
  if [ -t 0 ]; then tty=-t; else tty=; fi
  docker exec -i $tty -u hermes "$host" hermes auth add anthropic --type oauth --no-browser
}

company_usage() {
  echo 'Usage: gtmworks company add --name <Company> [--owner <email>] | gtmworks company link <Company> | gtmworks company list' >&2
  exit 1
}
# `gtmworks company add` (#382, #383, ADR 0018, 0019): one new Company, its Engine made from the template with its own
# volume, key and network. A named existing Person is checked before anything exists; with no --owner the Company's name is
# held behind a first-Owner link whose secret is printed once, after `#`. The Engine is made and waited on before either;
# a failure removes everything this command made, in one plain line, so the same command can be run again.
company_add() {
  company_name= owner_email= has_owner=no
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) [ $# -ge 2 ] || company_usage; company_name=$2; shift;;
      --owner) [ $# -ge 2 ] || company_usage; owner_email=$2; has_owner=yes; shift;;
      *) company_usage;;
    esac
    shift
  done
  test -n "$company_name" || company_usage
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  # A versioned restore replaces the install over several installer runs and holds .install-restore while it does
  # (#378, C5): a Company made between its safety backup and the replacement would be lost without being in that backup,
  # so this refuses until the restore has finished.
  if [ -f .install-restore ] && ! flock -n .install-restore true > /dev/null 2>&1; then
    echo 'A restore is running: wait for it to finish, then run this again.' >&2
    return 1
  fi
  # The Owner and the name are checked in the database before an Engine, a folder or a record is made.
  set -- --name "$company_name"
  [ "$has_owner" = no ] || set -- "$@" --owner "$owner_email"
  slug=$(compose exec -T web node scripts/company-add.mjs check "$@") || return 1
  slug=$(printf '%s\n' "$slug" | tail -n 1)
  case "$slug" in ''|*[!a-z0-9-]*) echo "The Company's Engine folder name is not usable: $slug" >&2; return 1;; esac
  volume=$(engine_project "$slug")
  network=$(engine_project "$slug")
  address="http://$(engine_project "$slug"):8642"
  key=$(new_engine_key)
  # Anything that ends this command before the Company's ownership is committed takes back what the command made (#378,
  # C10): the Engine's container, volume, network and folder, and any record waiting for a Company. The Engine's folder is
  # the first thing made, so the rollback is in place before it. The interrupt trap is set back once the Company is made.
  add_slug=$slug add_address=$address add_volume=$volume add_network=$network add_started=no
  # An Engine a Company already names is never taken back: a signal after the Company was made, or a record that cannot
  # be read, keeps it and says so; only a record no Company holds goes with its Engine.
  rollback_add() {
    [ -n "$add_slug" ] || return 0
    # Once the add has started in the web container it can still register the Engine and make the Company after this
    # command is interrupted, so from then on an interrupt keeps the Engine and leaves the answer to `company list`.
    if [ "$add_started" = yes ]; then
      echo "The Engine $(engine_project "$add_slug") stays: its Company may be made. Run gtmworks company list to see its state." >&2
      add_slug=
      return 0
    fi
    held=$(compose exec -T web node scripts/company-add.mjs drop --address "$add_address" 2> /dev/null) || held=unknown
    if [ "$held" = removed ]; then
      engine_destroy "$add_slug" "$add_volume" "$add_network" || true
    else
      echo "The Engine $(engine_project "$add_slug") stays: a Company may already be made on it. Run gtmworks company list to see its state." >&2
    fi
    add_slug=
  }
  trap 'rollback_add; exit 1' HUP INT TERM
  write_engine_env "$slug" "$key" "$volume" "$network" || {
    rollback_add
    echo "Company \"$company_name\" was not made: its Engine's folder could not be written. Nothing was left behind."
    return 1
  }
  if ! engine_start "$slug" >&2 || ! join_engine_network "$network"; then
    rollback_add
    echo "Company \"$company_name\" was not made: its Engine did not become healthy. Nothing was left behind; run the same command again."
    return 1
  fi
  # One add for both paths: the Owner is the only difference, and a failure removes what this command made (#378, C11): a
  # record a Company names means the Company was made, so its Engine stays and this says what the install holds.
  set -- --name "$company_name" --address "$address" --slug "$slug"
  add_started=yes
  [ "$has_owner" = no ] || set -- "$@" --owner "$owner_email"
  if ! ENGINE_ADDRESS="$address" ENGINE_KEY="$key" compose exec -T -e ENGINE_ADDRESS -e ENGINE_KEY web \
    node scripts/company-add.mjs add "$@"; then
    added=
    if added=$(compose exec -T web node scripts/company-add.mjs drop --address "$address" 2> /dev/null); then :; else added=unknown; fi
    case "$added" in
      held)
        add_slug=
        echo "Company \"$company_name\" was made on its own Engine ($(engine_project "$slug")): its Engine stays. Run gtmworks company list to see its state."
        return 1;;
      removed)
        add_slug=
        engine_destroy "$slug" "$volume" "$network"
        echo "Company \"$company_name\" was not made. Nothing was left behind; run the same command again."
        return 1;;
      *)
        add_slug=
        echo "The Company \"$company_name\" could not be read back after a failure, so its Engine ($(engine_project "$slug")) stays. Run gtmworks company list to see its state."
        return 1;;
    esac
  fi
  add_slug=
  trap 'exit 1' HUP INT TERM
  if [ "$has_owner" = yes ]; then
    echo "Company \"$company_name\" is made on its own Engine ($(engine_project "$slug")). Its Owner is $owner_email."
  else
    echo "Company \"$company_name\" is waiting for its Owner on its own Engine ($(engine_project "$slug")). Send the first-Owner link above; it works once."
  fi
}
# `gtmworks company link` (#383, ADR 0019): a fresh first-Owner link for a Company still waiting, which ends the earlier one.
company_link() {
  company_name=${1:-}
  test -n "$company_name" || company_usage
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  # A link written between a restore's safety backup and its replacement would stop working, or bring back an older one.
  if [ -f .install-restore ] && ! flock -n .install-restore true > /dev/null 2>&1; then
    echo 'A restore is running: wait for it to finish, then run this again.' >&2
    return 1
  fi
  compose exec -T web node scripts/company-add.mjs link --name "$company_name"
}
company() {
  case "${1:-}" in
    add) shift; company_add "$@";;
    link) shift; company_link "$@";;
    list) compose exec -T web node scripts/company-list.mjs companies;;
    *) company_usage;;
  esac
}
# Each Company now runs on its own Engine (ADR 0018). An install the previous release made keeps every Company on the one
# Engine, and this release has no path from there: refuse the update before it changes anything, so the release that runs
# keeps serving untouched. The count comes from the install's running database, which an update needs anyway. Only an
# install the previous release made is counted, and it is the one with no .engines/first: every install of this release
# writes that folder, so an install made since has an Engine per Company and its Companies, however many, go on.
refuse_several_companies() {
  [ ! -f .engines/first/.env ] || return 0
  companies=$(compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c \
    'select count(*) from public.companies;' 2> /dev/null) || companies=
  case "$companies" in
    ''|*[!0-9]*)
      echo "The update reads this install's Companies from its database: start gtmworks (sh scripts/install.sh), then run this again." >&2
      return 1;;
    0|1) return 0;;
  esac
  echo "This install has $companies Companies on one Engine. Each Company now needs its own Engine, and this release has no path for an install with more than one Company. Nothing was changed: the release you run still serves." >&2
  return 1
}
complete_env() {
  docker run --rm --env-file "$1" -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs missing > .install-lock/missing
  if [ -s .install-lock/missing ]; then
    if [ -n "$(tail -c 1 "$1")" ]; then echo >> "$1"; fi
    cat .install-lock/missing >> "$1"
  fi
  rm -f .install-lock/missing
}
# One helper container holding the data a backup copies or a restore writes: the database, its custom configuration and
# the stored files (through the running services' own volumes), and every Engine's data volume under /engines/<folder>
# (#386), so a restore puts each Engine's data back into the volume its own folder names. $1 is ro for a backup and rw
# for a restore, which makes each volume that is missing.
volumes() {
  mode=$1
  shift
  set -- "$@"
  for name in $(engine_names); do
    volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$(engine_folder "$name")/.env")
    test -n "$volume" || { echo "The Engine $name names no data volume: run sh scripts/install.sh." >&2; return 1; }
    if [ "$mode" = rw ]; then docker volume create "$volume" > /dev/null || return 1; fi
    set -- -v "$volume:/engines/$name:$mode" "$@"
  done
  docker run --rm --volumes-from "$(compose ps -aq db)" --volumes-from "$(compose ps -aq storage)" \
    --tmpfs /engines "$@"
}
# The migrations this release carries, applied in one transaction and recorded in gtmworks_install.schema_migrations: an
# install and an update run it before the app starts, and a restore runs it on the database it just put back, so an
# archive from an earlier release never serves on a schema this release cannot read (#378, C3). It is the same block an
# update applies to a previous release's database, so that path already proves it.
apply_migrations() {
  {
    printf '%s\n' 'select pg_advisory_xact_lock(237);' 'create schema if not exists gtmworks_install;' \
      'revoke all on schema gtmworks_install from public, anon, authenticated, service_role;' \
      'create table if not exists gtmworks_install.schema_migrations(name text primary key);' \
      'select not exists(select 1 from gtmworks_install.schema_migrations) as bootstrap \gset' \
      '\if :bootstrap' '\ir /bootstrap-grants.sql' '\endif'
    for file in supabase/migrations/*.sql; do
      case "$file" in *.verify.sql) continue;; esac
      migration=${file##*/}
      printf '%s\n' "select exists(select 1 from gtmworks_install.schema_migrations where name='$migration') as applied \gset" \
        '\if :applied' '\else' "\echo Applying migration: $migration" "\ir /migrations/$migration" \
        "insert into gtmworks_install.schema_migrations values ('$migration');" '\endif'
    done
    printf "notify pgrst, 'reload schema';\n"
  } | compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction
}
# The one check of a backup archive, made before anything stops or changes: only the backup's own entries, none outside
# it, each of them present, and every Company's Engine with its data and a usable key (#378, T4). It sets engines_layout,
# hermes_data and engine_keys for the restore that follows. get.sh runs it as `check-restore`, so a restore --version asks
# the same questions of the target release's own installer.
check_backup() {
  # The archive is copied and listed under `.install-lock`, and this function runs left of `||`, where errexit is off: a
  # copy or a listing that fails is reported and refused here, never read as an empty or a half archive (#378, C12).
  cp "$1" .install-lock/backup.tgz || { echo 'Could not read the backup.' >&2; return 1; }
  docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
    tar -tzf /backup/backup.tgz > .install-lock/entries || { echo 'Could not read the backup.' >&2; return 1; }
  # `tar -tzf` names entries and no member type. A symbolic or hard link member could make a restore write outside the
  # volumes it replaces, so the archive is listed with its modes and any link member is refused (#378, C15).
  docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
    tar -tvzf /backup/backup.tgz > .install-lock/listing || { echo 'Could not read the backup.' >&2; return 1; }
  # BusyBox (Alpine 3.21) lists a symbolic link as `l... name -> target` and a hard link as a regular `-...` member with
  # ` -> target`; GNU tar marks a hard link `h` or `link to`. Any of these is refused.
  if grep -Eq '^(l|h)| -> | link to ' .install-lock/listing; then echo 'Unsafe backup path.' >&2; return 1; fi
  while IFS= read -r entry; do
    case "$entry" in /*|*../*|../*|*/..) echo 'Unsafe backup path.' >&2; return 1;; esac
    case "$entry" in .env.install|engines.list|var/lib/postgresql/data/*|etc/postgresql-custom/*|var/lib/storage/*|opt/data|opt/data/*|engines|engines/*|.engines|.engines/*) ;; *) echo 'Unrecognised backup.' >&2; return 1;; esac
  done < .install-lock/entries
  for entry in var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install; do
    grep -Fx "$entry" .install-lock/entries >/dev/null || { echo 'Incomplete backup.' >&2; return 1; }
  done
  # A backup of this release names in engines.list every Engine its Companies name (#378, C4): each must be in the archive
  # with its data and its key, or a Company would come back without its own Engine. An archive without that list was made
  # by a release before it, and keeps the rules below.
  # Only this release writes the per-Engine layout, and it always writes engines.list with it: such an archive without its
  # list has lost part of itself and is refused. The one-Engine layout of earlier releases has no list.
  if grep -q '^engines/' .install-lock/entries && ! grep -Fxq 'engines.list' .install-lock/entries; then
    echo 'Incomplete backup.' >&2; return 1
  fi
  if grep -Fxq 'engines.list' .install-lock/entries; then
    docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
      tar -xOzf /backup/backup.tgz engines.list > .install-lock/engines.list || { echo 'Could not read the backup.' >&2; return 1; }
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      printf '%s\n' "$name" | grep -Eq '^[a-z0-9-]+$' \
        || { echo "The backup names an Engine folder that is not usable: $name" >&2; return 1; }
      grep -Fxq "engines/$name/" .install-lock/entries \
        && grep -Fxq ".engines/$name/.env" .install-lock/entries \
        || { echo 'The backup does not hold an Engine for every Company.' >&2; return 1; }
    done < .install-lock/engines.list
  fi
  # Every Company runs on its own Engine (ADR 0018), so an archive made by this release holds one data folder per Engine
  # under engines/, named as its folder under .engines/ (where its key is). An archive made before that holds the first
  # Engine's data at opt/data and its key in .engines/first/.env, or, older still, in .env.install. An archive naming an
  # Engine without its data, data without its key, or both layouts at once cannot be fully restored: say so here, before
  # anything stops or changes.
  engines_layout=no
  if grep -Eq '^engines/' .install-lock/entries; then engines_layout=yes; fi
  engine_data=$(sed -n 's#^engines/\([^/][^/]*\)/.*#\1#p' .install-lock/entries | sort -u)
  engine_key_folders=$(sed -n 's#^\.engines/\([^/][^/]*\)/\.env$#\1#p' .install-lock/entries | sort -u)
  # An archive from before #349 holds no Engine data: the install restores as it did, and says what the backup left out.
  hermes_data=no
  if grep -Eq '^opt/data/?$' .install-lock/entries; then hermes_data=yes; fi
  # An archive from before #385 holds no .engines/: its key is in .env.install, and this installer moves it into the
  # Engine's own file below, as an update does.
  engine_keys=no
  if grep -Eq '^\.engines/first/\.env$' .install-lock/entries; then engine_keys=yes; fi
  if [ "$engines_layout" = yes ]; then
    if [ "$hermes_data" = yes ]; then echo 'Unrecognised backup.' >&2; return 1; fi
    test "$engine_data" = "$engine_key_folders" || { echo 'The backup does not hold an Engine for every Company.' >&2; return 1; }
    if [ -n "$engine_data" ]; then
      printf '%s\n' "$engine_data" | grep -qx first || { echo 'The backup does not hold an Engine for every Company.' >&2; return 1; }
      hermes_data=yes
    fi
  else
    test -z "$(printf '%s\n' "$engine_key_folders" | grep -vx first | grep .)" \
      || { echo 'The backup does not hold an Engine for every Company.' >&2; return 1; }
  fi
  # An archive is not trusted with an Engine folder's name or its whole file (#378, X2): each Engine folder is named like
  # an Engine, and only its ENGINE_KEY is taken (64 hex characters), which this installer writes from below with this
  # release's own ENGINE_NAME/ENGINE_VOLUME/ENGINE_NETWORK. A file that could point the install network or the database's
  # volume at something else is never used.
  for name in $engine_key_folders; do
    printf '%s\n' "$name" | grep -Eq '^[a-z0-9-]+$' \
      || { echo "The backup names an Engine folder that is not usable: $name" >&2; return 1; }
    key=$(docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
      tar -xOzf /backup/backup.tgz ".engines/$name/.env" | sed -n 's/^ENGINE_KEY=//p') || return 1
    printf '%s\n' "$key" | grep -Eq '^[a-f0-9]{64}$' \
      || { echo "The backup's Engine $name has no usable key." >&2; return 1; }
  done
  return 0
}

operation=${1:-install}
if [ -n "$release_image" ]; then
  # Release mode replaces the install files below; a checkout's own copies of them are source code.
  test ! -e scripts/install.sh || {
    echo 'A release install runs in its own directory, not in a source checkout: run sh scripts/install.sh here.' >&2; exit 1; }
  # A compose file from another release would migrate one version and start another.
  grep -qF "image: $release_image" docker-compose.install.yml || {
    echo "docker-compose.install.yml is not from the release of $release_image: download both files of one release." >&2; exit 1; }
  # The work sandbox image is part of the release too: one written without it would leave every Company's sandbox
  # with an image the release did not pin (#392).
  test -n "$sandbox_image" || {
    echo "This release names no work sandbox image: download both files of one release." >&2; exit 1; }
  # Backup and restore restart the stack without migrating, so they run only with the files of the release it runs.
  case "$operation" in backup|restore)
    test "$(cat .install-release 2>/dev/null)" = "$release_image" || {
      echo "This install does not run $release_image yet: run sh install.sh update first, or use the files of the release it runs." >&2; exit 1; };;
  esac
fi
if [ "$operation" = backup ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  refuse_previous_release_engine || exit 1
  destination=${2:-backups}
  mkdir -p "$destination"
  # The stack starts again after the copy, every Engine included, and an install the previous release made has its
  # Engine key moved into the Engine's own file then (#385).
  complete_env "$PWD/.env.install"
  # The Engines this install's Companies name, read while the database still runs (#378, C4): a restore needs every one of
  # them, so the archive carries their folders in engines.list. The read must succeed: an empty list here would quietly
  # leave the restore's check with nothing to require. An install from before the Engine records was refused above.
  compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c \
    'select e.address from public.company_engines e join public.companies c on c.engine_id=e.id order by e.address;' \
    > .install-lock/addresses \
    || { echo "Could not read this install's Engine records: start gtmworks (sh scripts/install.sh), then run this again. Nothing was archived." >&2; exit 1; }
  sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p' .install-lock/addresses | sort -u > .install-lock/engines.list || exit 1
  resume=yes
  engine_stop
  engines_stopped || exit 1
  compose stop
  # BusyBox tar applies the last -C to every entry, so keep all paths under one root. Every Company runs on its own
  # Engine (ADR 0018), so every Engine's data volume goes in, one folder per Engine under engines/ (#386): each
  # Company's Agents, profiles, rules, knowledge, skills, memory and history live in its own Engine's volume, and each
  # Engine's key lives in .engines/ (#385), so a restore brings back an Engine that answers to the same key. An install
  # that has not run this installer yet has no .engines/; its key is in .env.install. engines.list names the Engines the
  # Companies name, so a restore can refuse an archive that would leave one of them out (#378, C4).
  mkdir -p .engines
  volumes ro -v "$PWD/.env.install:/.env.install:ro" -v "$PWD/.engines:/.engines:ro" \
    -v "$PWD/.install-lock/engines.list:/engines.list:ro" alpine:3.21 tar -czf - \
    -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage engines .env.install .engines engines.list > .install-lock/backup.tgz
  archive="$destination/gtmworks-$(date -u +%Y%m%dT%H%M%SZ)-$$.tgz"
  mv .install-lock/backup.tgz "$archive"
  echo "Backup: $archive"
  return
elif [ "$operation" = restore ]; then
  test -f .env.install && test -f "${2:-}" || { echo 'Usage: sh scripts/install.sh restore <archive> (into an empty install)' >&2; exit 1; }
  refuse_previous_release_engine || exit 1
  check_backup "$2" || exit 1
  docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
    tar -xOzf /backup/backup.tgz .env.install > .env.install.tmp
  complete_env "$PWD/.env.install.tmp"
  docker run --rm --env-file .env.install.tmp -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs validate complete
  resume=yes
  engine_stop
  compose stop web worker gateway auth rest storage mail
  empty=$(compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c \
    'select not exists(select 1 from public.companies) and not exists(select 1 from auth.users) and not exists(select 1 from storage.objects);')
  test "$empty" = t || { echo 'Restore requires an empty install.' >&2; exit 1; }
  compose stop db
  # A failed extraction must stay offline, rather than start a partially restored database.
  resume=no
  # This empty install's Engine keys are its own, made a moment ago; the archive's take their place, so each Engine whose
  # data went back answers to the key the archive kept (#385). An archive from before .engines/ keeps the key in
  # .env.install, which first_engine_up below moves into the Engine's own file. The key folders are read first, because each
  # Engine's data goes back into the volume its own folder names.
  rm -rf .engines
  if [ "$engine_keys" = yes ]; then
   # Only each Engine's key comes from the archive (checked above), read out of it as the archive's .env.install is, never
   # extracted: its own file is written here with this release's standard names, so a restored Engine always gets its own
   # container, volume and network (#378, X2). Reading as the container's root also works under rootless Docker, where
   # the invoking user's own files are root's inside a container.
   for name in $engine_key_folders; do
     key=$(docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
       tar -xOzf /backup/backup.tgz ".engines/$name/.env" | sed -n 's/^ENGINE_KEY=//p') || exit 1
     if [ "$name" = first ]; then
       write_engine_env first "$key" "$engine_volume" "$(engine_project first)"
     else
       write_engine_env "$name" "$key" "$(engine_project "$name")" "$(engine_project "$name")"
     fi
   done
  fi
  if [ "$engines_layout" = yes ]; then
    # One folder per Engine (#386): each Engine's volume is mounted under its folder's name, emptied, and the archive's
    # data for it goes back where its record's address finds it.
    volumes rw -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      for folder in /engines/*/; do [ -d "$folder" ] || continue; find "$folder" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; done
      # Keep the image UIDs/GIDs and modes instead of resolving owners in this helper.
      tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage engines
    '
  else
    # An archive from before this release: the first Engine is the install's one Engine, and its data is at opt/data.
    first_volume=$engine_volume
    if [ -f "$(engine_folder first)/.env" ]; then first_volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$(engine_folder first)/.env"); fi
    volumes rw -v "$first_volume:/opt/data" -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      for folder in /engines/*/; do [ -d "$folder" ] || continue; find "$folder" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; done
      if [ "$1" = yes ]; then
        find /opt/data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
        # Keep the image UIDs/GIDs and modes instead of resolving owners in this helper.
        tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage opt/data
      else
        # An archive from before #349: the Engine volume of this empty install stays as it is.
        tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage
      fi
    ' sh "$hermes_data"
  fi
  mv .env.install.tmp .env.install
  # The archive's database may be an earlier release's (a go-back, or an archive made before the Engines): this
  # release's migrations are applied while only the database is up, before web and the worker read it, exactly as an
  # update applies them to a previous release's database (#378, C3).
  compose up -d --wait --wait-timeout 300 db
  apply_migrations || return 1
  # The Engine's key is adopted before web and the worker are recreated (#378, X3): an archive made before #385 holds its
  # key in .env.install, which the containers read their environment from, so the key moves into the Engine's own file
  # first and the containers never start with it in their environment.
  adopt_engine_key || return 1
  compose up -d --force-recreate --wait --wait-timeout 300
  # Every Engine starts with its Company's sandbox (#393), so the image the restored install's sandboxes run is recorded
  # first, as an install records it: a release pins it, a checkout builds it once.
  work_sandbox_image || return 1
  engines_up
  # The database now has this release's schema and every Company names one Engine, or names none (an archive made by an
  # earlier release): the record is settled in one transaction, as an update does (#378).
  ENGINE_ADDRESS="$engine_address" ENGINE_KEY="$(engine_key)" compose exec -T -e ENGINE_ADDRESS -e ENGINE_KEY web node scripts/install-engine.mjs || return 1
  # The archive's database decides which Engines its Companies need: an archive that lost an Engine together with its
  # list and key passes the checks above, so every Engine the restored Companies name must have come back (#378, C4).
  restored_engines=$(compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c \
    'select e.address from public.company_engines e join public.companies c on c.engine_id=e.id;') \
    || { echo "Could not read the restored Companies' Engines." >&2; return 1; }
  for address in $restored_engines; do
    name=$(printf '%s\n' "$address" | sed -n 's#^http://gtmworks-engine-\([a-z0-9-]*\):8642$#\1#p')
    if [ -z "$name" ] || [ ! -f "$(engine_folder "$name")/.env" ]; then
      echo "The restored database names an Engine the backup did not hold ($address): this archive is not complete." >&2
      return 1
    fi
  done
  if [ "$hermes_data" = no ]; then
    echo "The Agents' Hermes data was not in this backup: their knowledge, rules, skills and memory were not restored."
  fi
  # The image the restored install's sandboxes start from is recorded only now that the restore is whole (#393).
  mv .install-lock/work-sandbox-image .work-sandbox-image || { echo 'The restored install could not record its work sandbox image.' >&2; return 1; }
  return
elif [ "$operation" = check-restore ]; then
  # get.sh runs this with the target release's own installer before it changes anything (#378, T4): the same check a
  # restore makes, and nothing is stopped, migrated or written.
  test -f "${2:-}" || { echo 'Usage: sh scripts/install.sh check-restore <archive>' >&2; exit 1; }
  check_backup "$2" || exit 1
  echo 'The backup can be restored.'
  return
elif [ "$operation" = update ] && [ -n "$release_image" ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  test -z "${2:-}" || { echo 'A release install updates to the next release: put its docker-compose.install.yml and install.sh here, then run sh install.sh update.' >&2; exit 1; }
  refuse_several_companies || return 1
elif [ "$operation" = update ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  refuse_several_companies || return 1
  ref=${2:-main}
  case "$ref" in ''|*[!a-zA-Z0-9._/-]*) echo 'Invalid version reference.' >&2; exit 1;; esac
  echo "Downloading update source: $ref"
  docker run --rm -e GH_TOKEN -v "$PWD:/install" alpine:3.21 sh -ec '
    if [ -n "${GH_TOKEN:-}" ]; then
      wget -qO /install/.install-lock/source.tgz --header "Authorization: Bearer $GH_TOKEN" \
        "https://api.github.com/repos/omarabdo516/gtmworks/tarball/$1"
    else
      wget -qO /install/.install-lock/source.tgz "https://codeload.github.com/omarabdo516/gtmworks/tar.gz/$1"
    fi
    echo "Extracting update source..."
    tar -xzf /install/.install-lock/source.tgz -C /install --strip-components=1
  ' sh "$ref"
elif [ "$operation" = sign-in ]; then
  shift
  sign_in "$@"
  return
elif [ "$operation" = company ]; then
  shift
  company "$@"
  return
elif [ "$operation" = engines ]; then
  # Every Engine's state, as `gtmworks status` reports it (scripts/get.sh), and every Company's work sandbox beside it:
  # the sandbox state comes from the host's Docker, which the web container does not hold. Non-zero when an Engine or a
  # sandbox does not answer, so `gtmworks status` names it.
  report_status=0
  report=$(compose exec -T web node scripts/company-list.mjs engines) || report_status=$?
  printf '%s\n' "$report"
  status=$report_status
  for name in $(engine_names); do
    folder=$(engine_folder "$name")
    [ -f "$folder/.env" ] || continue
    container=$(sandbox_container "$name")
    line=$(printf '%s\n' "$report" | grep -F "Engine http://$(engine_project "$name"):8642:" | head -n 1)
    company=$(printf '%s\n' "$line" | sed -n 's/.*Company "\([^"]*\)".*/\1/p')
    if ! listed=$(docker ps -aq --filter "name=^${container}$" 2> /dev/null); then
      state=unknown
    elif [ -z "$listed" ]; then
      state='not created'
    else
      running=$(docker inspect -f '{{.State.Running}}' "$container" 2> /dev/null || echo unknown)
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2> /dev/null || echo unknown)
      if [ "$running" != true ]; then state=stopped
      elif [ "$health" = healthy ]; then state=running
      else state="running, not healthy ($health)"; fi
    fi
    [ "$state" = running ] || status=1
    if [ -n "$company" ]; then
      echo "Sandbox $container: $state (Company \"$company\")"
    else
      echo "Sandbox $container: $state"
    fi
  done
  return "$status"
elif [ "$operation" != install ]; then
  echo 'Usage: sh scripts/install.sh [update [ref] | backup [directory] | restore <archive> | company add --name <Company> [--owner <email>] | company link <Company> | company list | engines]' >&2; exit 1
fi
# A plain install run on an install the previous release made (its `hermes` container, no Engine folder) moves it to this
# release as an update does, so it is refused the same way when that install holds several Companies on its one Engine,
# before anything is pulled, migrated or replaced.
if [ "$operation" = install ] && previous_release_engine; then refuse_several_companies || exit 1; fi
if [ -n "$release_image" ]; then
  docker pull "$release_image"
  # From here the files on disk belong to this release until the run finishes, so backup and restore wait for that.
  rm -f .install-release
  # The image carries what a checkout holds for the install: migrations, database and gateway files, lib/install-env.mjs.
  # The migrations are replaced, not merged, so a rolled-back release leaves none of its own to apply again. The folder is
  # emptied, never removed, and files are overwritten in place: the running db and gateway bind-mount these by inode, so a
  # folder made anew would leave psql reading the old, deleted one.
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/install" "$release_image" \
    sh -ec 'mkdir -p /install/supabase/migrations; find /install/supabase/migrations -mindepth 1 -delete; cp -R /app/install/. /install/'
fi
if [ ! -f .env.install ]; then
  docker run --rm -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs generate > .env.install.tmp
  mv .env.install.tmp .env.install
fi
chmod 600 .env.install
# An install made before a value existed (the bundled Hermes key, ADR 0010) gains it here; nothing else changes.
complete_env "$PWD/.env.install"
echo 'Validating install configuration...'
docker run --rm --env-file .env.install -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs validate complete
# A broken gateway config stops here, before migrations or any container changes, while the old version still serves.
echo 'Checking gateway configuration...'
compose run --rm --no-deps gateway nginx -t
if [ "$operation" = install ]; then compose up -d --wait db auth rest storage mail; fi
apply_migrations
if [ -z "$release_image" ]; then
  # Tests only (#406): CI's install jobs load the one image the `image` job built, under this compose file's own tag,
  # and set this so no job builds the app image again. GTMWORKS_IMAGE_PREBUILT is read here and in work_sandbox_image
  # only; a source install anywhere else builds its images, as it always has.
  if [ "${GTMWORKS_IMAGE_PREBUILT:-}" != true ]; then
    compose build web
  else
    # One line names the image this install runs, so the log says why no build ran (#411).
    echo 'Using the prebuilt web image (GTMWORKS_IMAGE_PREBUILT=true); not building it.'
  fi
  # Compose does not recreate a container when only a file it mounts changed. The gateway is recreated when it is not
  # running, when its compose definition differs from the one it runs (its config-hash label), or when its mounted files
  # differ from those it last started with (.install-gateway): a new config (the X-Real-IP the auth rate limit counts by,
  # issue #41) is the one that serves, and an unchanged gateway keeps running (issue #78). The worker reaches the
  # database through the gateway, so a running worker stops first and the app start below brings it back (or, should the
  # run fail before then, the exit does): it never meets a gateway that went away under it. A release install lets
  # compose recreate what its pinned files changed and reloads the gateway below.
  gateway_hash=$(compose config --hash gateway)
  gateway_hash=${gateway_hash##* }
  cksum scripts/install-nginx.conf scripts/install-gateway-real-ip.sh > .install-lock/gateway
  gateway=$(compose ps -q --status running gateway)
  worker=$(compose ps -q --status running worker)
  serving=
  if [ -n "$gateway" ]; then serving=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$gateway"); fi
  if [ -z "$serving" ] || [ "$serving" != "$gateway_hash" ] || ! cmp -s .install-lock/gateway .install-gateway; then
    if [ -n "$worker" ]; then worker_stopped=yes; compose stop worker; fi
    compose up -d --no-deps --force-recreate --wait --wait-timeout 300 gateway
    mv .install-lock/gateway .install-gateway
  fi
fi
# The image every Company's work sandbox runs (#392, ADR 0020): pulled from the release's pin or built from this
# checkout, and recorded before anything can make a Company's sandbox.
work_sandbox_image || exit 1
# Every Engine is made from the template before the app and the worker start, recreated when the release pins a new
# image, and left running otherwise.
engines_up
if [ "$operation" = update ] && [ -z "$release_image" ]; then
  # auth is recreated when its settings changed (password rules, reset-link lifetime, session length) and must be healthy.
  compose up -d --no-deps --wait --wait-timeout 300 auth web worker
else
  # A release pins every service by digest: compose recreates each one the release changed and leaves the rest running.
  compose up -d --wait --wait-timeout 300
fi
worker_stopped=no
# The app and the worker join every Engine's network once they exist, and again after every recreation.
join_engine_networks
# The extraction replaced the gateway configuration in place; Nginx reads it again without dropping connections.
if [ "$operation" = update ] && [ -n "$release_image" ]; then compose exec -T gateway nginx -s reload; fi
# The install's Engine record (#380, #378, ADR 0018): its address and key, the key encrypted with WEBHOOK_ENCRYPTION_KEY,
# kept in the database for the app and the worker to answer from. The installer passes the Engine's own address and key to
# this script alone; they are not in the app's or the worker's environment. A fresh install leaves one record waiting for
# first run's first Company; an install made by the release before this one adopts the Engine it already runs as its one
# Company's Engine (the record written and the Company naming it, in one transaction), so the Company keeps answering. An
# install this release made is left as it is.
ENGINE_ADDRESS="$engine_address" ENGINE_KEY="$(engine_key)" compose exec -T -e ENGINE_ADDRESS -e ENGINE_KEY web node scripts/install-engine.mjs
# Each address must answer 200. Right after the migrations PostgREST reloads its schema cache (and the gateway its
# configuration), and the app's health answers 503 meanwhile: the probes try again once a second, 60 tries in all, and
# fail naming the address and its last answer when 200 never comes.
compose exec -T web node -e "let tries=60; for(const url of ['http://gateway:8080/api/health','http://gateway:8080/sign-in','$engine_address/health']) { for(;;) { let answer; try { answer=(await fetch(url)).status; } catch(error) { answer=error.message; } if(answer===200) { console.log(url+' 200'); break; } if(--tries<=0) throw new Error(url+' returned '+answer); await new Promise(resolve=>setTimeout(resolve,1000)); } }" --input-type=module
# The gtmworks command (#437): a folder the one line made keeps get.sh as gtmworks.sh, and the release now running leaves
# the one its image carries. A command from before #437 never replaced itself, but its update runs this, so the update
# brings the new command too. The new file is moved over the old one, never written into it: the old one may be the
# script running this. A file that is not the installer is refused and the old copy kept; the release itself runs.
if [ -n "$release_image" ] && [ -f gtmworks.sh ]; then
  if docker run --rm "$release_image" cat /app/release-source/scripts/get.sh > gtmworks.sh.tmp 2> /dev/null \
    && [ "$(sed -n 2p gtmworks.sh.tmp)" = '# gtmworks get.sh: the one-line installer, and the gtmworks command it leaves behind (#51, #52).' ]; then
    chmod 755 gtmworks.sh.tmp
    mv gtmworks.sh.tmp gtmworks.sh
  else
    rm -f gtmworks.sh.tmp
    echo "The gtmworks command in $release_image is not the gtmworks installer: gtmworks.sh is kept." >&2
  fi
fi
if [ -n "$release_image" ]; then printf '%s\n' "$release_image" > .install-release; fi
# The work sandbox image this run made is recorded only now, with the install whole (#393, as before #393): a run that
# failed leaves the image an earlier run recorded, and the exit handler starts no build.
mv .install-lock/work-sandbox-image .work-sandbox-image
# Whether first run is still open, asked through the app's service role; it answers open or closed and nothing else.
setup=$(compose exec -T web node -e "const key=process.env.SUPABASE_SERVICE_ROLE_KEY; const response=await fetch('http://gateway:8080/rest/v1/rpc/setup_is_open',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key}}); if(!response.ok) throw new Error('setup_is_open returned '+response.status); console.log(await response.json()===true?'open':'closed');" --input-type=module)
echo 'Mail: http://localhost:8025'
echo 'Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory.'
# The last line: the one-time setup link while first run is open (issue #50), the sign-in address after.
docker run --rm --env-file .env.install -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs ready "$setup"
exit 0
}
main "$@"
