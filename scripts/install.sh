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
# A source update hands its run to the installer it downloaded (below): that installer inherits the lock on descriptor 9
# and this run's scratch folder, which holds the previous release's Engine files.
if [ "${GTMWORKS_UPDATE_DOWNLOADED:-}" = 1 ] && flock -n 9 2> /dev/null; then
  mkdir -p .install-lock
else
GTMWORKS_UPDATE_DOWNLOADED=
exec 9>.install.lock
flock -n 9 || { echo 'Another install is running: wait for it to finish, then run this again.' >&2; exit 1; }
# shortcut: an installer from before #67 locks with the folder and its owner file, not flock; while one still runs it keeps
# its folder. Remove this once no install can still run a pre-#67 installer.
old_pid=; if [ -f .install-lock/owner ]; then read -r _ old_pid _ < .install-lock/owner || true; fi
case "$old_pid" in ''|*[!0-9]*) ;; *) if kill -0 "$old_pid" 2> /dev/null; then echo 'Another install is running (or remove stale .install-lock).' >&2; exit 1; fi;; esac
rm -rf .install-lock
mkdir .install-lock
fi
resume=no
worker_stopped=no
# Whether this run puts the previous release's Engine files back if it fails (#554): `kept` from when an update kept
# them, `rollback` while its Engines start (a rollback puts them back first), and empty once every Engine started from
# this release's files, or for any other run.
engine_files=
cleanup() {
  status=$?
  trap - EXIT
  # Only an install that had an Engine folder before this run starts its Engines again: a run that refused, or a backup of
  # an install the previous release made, must never write .engines/first/.env itself (#378, C13).
  if [ "$resume" = yes ]; then compose up -d --wait --wait-timeout 300 || status=1; if [ -f "$(engine_folder first)/.env" ]; then engines_up || status=1; fi; fi
  # A run that stopped the worker for a gateway change and failed before the app started leaves it running again.
  if [ "$worker_stopped" = yes ]; then compose start worker || status=1; fi
  # An update that failed before its Engines all started: the previous release keeps serving, so its own Engine files
  # go back on disk in place of the ones the update copied, whichever step failed. After a rollback this copies the kept
  # ones again, in case the rollback stopped before it did.
  # A rollback removes the files this release brought itself once no Engine of it can restart on them.
  if [ "$status" -ne 0 ] && [ -n "$engine_files" ]; then
    if [ "$engine_files" = rollback ]; then
      previous_engine_files_kept_back || echo "The previous release's own Engine files could not be put back: run the install command again." >&2
    elif previous_engine_files_back; then
      echo "This update stopped before its Engines started: the previous release's own Engine files are back." >&2
    else
      echo "The previous release's own Engine files could not be put back: run the install command again." >&2
    fi
  fi
  rm -f .env.install.tmp
  rm -rf .install-lock
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
node_image=node:22.14.0-alpine3.21
# The app and the worker join every Company's Engine network through a Compose file the installer writes beside the
# release's (#773, ADR 0018: the installer on the host writes it; no Docker API enters the install):
# docker-compose.engines.yml, made again from the Engines this install has before every Compose command that makes
# containers, so any such command that recreates them (an update, a restore, an Owner's own `docker compose ... -f
# docker-compose.engines.yml up --force-recreate`, README) leaves them on each Engine's network, the app as `web` there.
# A network that is gone (a Company removed) is left out, so the file never names one Compose cannot find.
engines_file=docker-compose.engines.yml
write_engines_file() {
  ef_networks=
  for ef_name in $(engine_names); do
    ef_network=$(engine_network_of "$ef_name")
    [ "$ef_name" = first ] && ef_network=${ef_network:-gtmworks-engine-first}
    [ -n "$ef_network" ] || continue
    docker network inspect "$ef_network" > /dev/null 2>&1 || continue
    case " $ef_networks " in *" $ef_network "*) ;; *) ef_networks="$ef_networks $ef_network" ;; esac
  done
  {
    echo '# Written by scripts/install.sh before every Compose command (#773): the app and the worker on each Company'"'"'s'
    echo '# Engine network. Do not edit: the next install command writes it again from the Engines this install has.'
    if [ -z "$ef_networks" ]; then echo 'services: {}'; else
      echo 'services:'
      for ef_service in web worker; do
        echo "  $ef_service:"
        echo '    networks:'
        echo '      default: {}'
        for ef_net in $ef_networks; do
          if [ "$ef_service" = web ]; then echo "      $ef_net:"; echo '        aliases: [web]'; else echo "      $ef_net: {}"; fi
        done
      done
      echo 'networks:'
      for ef_net in $ef_networks; do echo "  $ef_net:"; echo '    external: true'; done
    fi
  } > "$engines_file.tmp" && mv "$engines_file.tmp" "$engines_file"
}
# Only a command that makes containers (up, create) needs the file: it is written then, from the Engines there are now.
compose() {
  case "$1" in
    up|create) write_engines_file || return 1
      docker compose --env-file .env.install -f docker-compose.install.yml -f "$engines_file" "$@" ;;
    *) docker compose --env-file .env.install -f docker-compose.install.yml "$@" ;;
  esac
}
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
      # The image the sandboxes run now keeps a name of its own while the build replaces the tag, so an update whose
      # sandboxes do not start puts it back (restore_previous_engine, ADR 0023).
      if docker image inspect "$work_sandbox_tag" > /dev/null 2>&1; then
        docker tag "$work_sandbox_tag" "$work_sandbox_tag-previous" || return 1
        # Only this run's rebuild moves the tag, so only this run puts it back: a -previous an earlier run left is older.
        : > .install-lock/work-sandbox-rebuilt
      else
        # No image yet: no earlier one stands in for it on a rollback.
        docker image rm "$work_sandbox_tag-previous" > /dev/null 2>&1 || true
      fi
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
# The one-off step that copies the sandbox image's Screen driver into the Engine's volume (#711): its container stays
# after it exits, so it has a name of its own, taken away with the sandbox and the exit.
screen_driver_container() { printf 'gtmworks-screen-driver-%s' "$1"; }
work_volume() { printf 'gtmworks-work-%s' "$1"; }
work_network() { printf 'gtmworks-work-%s' "$1"; }
host_key_volume() { printf 'gtmworks-sandbox-hostkey-%s' "$1"; }
# What one sandbox gets by default (the RAM and CPU the install gives a Company's sandbox, and the process limit and shared
# memory Chromium needs) is set in one place, the sandbox service of scripts/engine-template.yml, from the install job's
# measurement (#400); nothing here repeats a default. A Company's own memory and CPU limit (#396), given to `company add`
# or `company limits`, is kept in its Engine's folder beside its key, as SANDBOX_MEMORY and SANDBOX_CPUS, and only that
# file gives them to Compose: a value left in the shell never reaches a sandbox, so an update, a restore and a recreate
# give every sandbox the limits its Company was given, and a Company given none the template's default.
sandbox_limit() { sed -n "s/^SANDBOX_$2=//p" "$(engine_folder "$1")/.env" 2> /dev/null; }
# A limit is refused before anything changes when it is not one Docker reads as a size or a number of CPUs; what Docker
# itself refuses (more CPUs than the server has) fails the sandbox's start, which takes the change back.
check_limits() {
  [ -z "$1" ] || printf '%s\n' "$1" | grep -Eqx '[1-9][0-9]*[mg]' \
    || { echo "The memory limit is a whole number of megabytes or gigabytes, such as 512m or 2g, not $1." >&2; return 1; }
  [ -z "$2" ] || { printf '%s\n' "$2" | grep -Eqx '[0-9]+(\.[0-9]{1,2})?' && awk -v cpus="$2" 'BEGIN { exit !(cpus > 0) }'; } \
    || { echo "The CPU limit is a number of CPUs above 0, such as 1 or 1.5, not $2." >&2; return 1; }
}
# One Company's limits written into its Engine's file, owner-only, under a temporary name then moved into place; an
# empty value leaves that limit to the template's default. A memory limit of its own is noted with the default it was
# written under (SANDBOX_MEMORY_DEFAULT), so an update raises it only once for each new default (#711).
write_limits() {
  file="$(engine_folder "$1")/.env"
  {
    grep -Ev '^SANDBOX_(MEMORY|CPUS|MEMORY_DEFAULT)=' "$file" || true
    [ -z "$2" ] || printf 'SANDBOX_MEMORY=%s\nSANDBOX_MEMORY_DEFAULT=%s\n' "$2" "$(default_sandbox_memory)"
    [ -z "$3" ] || printf 'SANDBOX_CPUS=%s\n' "$3"
  } > "$file.tmp" || return 1
  chmod 600 "$file.tmp" || return 1
  mv "$file.tmp" "$file" || return 1
}
# The install's default memory for one sandbox, read from the one place it is set, the sandbox service of the template.
default_sandbox_memory() { sed -n 's/^    mem_limit: ${SANDBOX_MEMORY:-\([0-9]*[mg]\)}$/\1/p' "$engine_template"; }
# A size as Docker reads it (512m, 2g) in megabytes.
megabytes() { case "$1" in *g) echo $(( ${1%g} * 1024 ));; *m) echo "${1%m}";; *) return 1;; esac; }
# A Company's sandbox holds its Screen, which its Agents share (#711), so an update to a release whose default memory is larger raises a
# Company's own limit below it to that default, once for that default, and never lowers one; a limit the Owner sets after
# that (`company limits`) is noted under the same default and kept. A Company with no limit of its own follows the default,
# and its file is not touched.
raise_sandbox_memory() {
  own=$(sandbox_limit "$1" MEMORY)
  [ -n "$own" ] || return 0
  default=$(default_sandbox_memory)
  test -n "$default" || { echo "The sandbox's default memory is not in $engine_template." >&2; return 1; }
  [ "$(sandbox_limit "$1" MEMORY_DEFAULT)" != "$default" ] || return 0
  [ "$(megabytes "$own")" -lt "$(megabytes "$default")" ] || return 0
  write_limits "$1" "$default" "$(sandbox_limit "$1" CPUS)" || return 1
  echo "The work sandbox of the Engine $1 had $own of memory: raised to $default, the new default, so its Screen fits."
}
# The Engine reaches its sandbox as every Agent's command does (#396): over ssh, as the Engine's own user, with its own
# key and the host key its known_hosts pins. A few tries, as Docker's name for the sandbox can take a moment to answer.
sandbox_reachable() {
  for attempt in 1 2 3; do
    docker exec -u hermes "$(engine_project "$1")" ssh -i /opt/data/ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile=/opt/data/.ssh/known_hosts -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 pn@sandbox true > /dev/null 2>&1 \
      && return 0
    sleep 2
  done
  return 1
}
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
  docker volume create "$(work_volume "$slug")" > /dev/null || return 1
  keys_failed=0
  keys=$(docker run --rm --user 0 --entrypoint sh -v "$volume:/data" -v "$(host_key_volume "$slug"):/keys" \
    -v "$(work_volume "$slug"):/work" "$image" -ec '
      set -e
      # An Engine with no sandbox key yet is one made before the work sandbox (#397): the files each of its Agents made in
      # the old Library root of its profile (`workspace`, on the disk of the Engine) are copied once into the own folder
      # of that Agent in the work folder of the Company, before the key is made, so a run that fails here copies again. A
      # file already there is never replaced, a link is copied as a link and never followed, every copy is readable by
      # the Library of the Engine, the originals stay as they are, and nothing goes into the folder of another Agent.
      if [ ! -s /data/ssh/id_ed25519 ]; then
        for old in /data/profiles/*/workspace; do
          [ -d "$old" ] && [ ! -L "$old" ] || continue
          profile=${old#/data/profiles/}; profile=${profile%/workspace}
          [ ! -L "/data/profiles/$profile" ] || continue
          install -d -m 755 -o 1000 -g 1000 "/work/$profile"
          tar -C "$old" --owner=1000 --group=1000 --numeric-owner --mode=u+rwX,go+rX -cf - . | tar -C "/work/$profile" --skip-old-files -xf -
        done
      fi
      install -d -m 700 -o 10000 -g 10000 /data/ssh
      if [ ! -s /data/ssh/id_ed25519 ]; then
        ssh-keygen -q -t ed25519 -N "" -C "gtmworks-work-sandbox" -f /data/ssh/id_ed25519
        echo made
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
    ') || keys_failed=1
  # An Engine whose key this run made is named in the scratch folder, so an update that goes back takes that key out
  # again (remove_new_sandbox_parts, #479); also when a later step of the same run failed, since the key stays made.
  if printf '%s\n' "$keys" | grep -qx made; then printf '%s\n' "$slug" >> .install-lock/sandbox-keys-made; fi
  [ "$keys_failed" = 0 ] || return 1
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
# The sandbox's names and image reach Compose in its environment only, never in .env.install or the Engine's own
# file: the names are derived from the folder above, so a restore needs no second record, and the public key that
# belongs to this Engine's private key is passed here.
engine() {
  slug=$1
  shift
  SANDBOX_IMAGE=${SANDBOX_IMAGE:-$(work_sandbox_ref || printf '%s' "$work_sandbox_tag")} \
  SANDBOX_NAME=$(sandbox_container "$slug") \
  SANDBOX_AUTHORIZED_KEY=${sandbox_key:-} \
  SANDBOX_MEMORY=$(sandbox_limit "$slug" MEMORY) \
  SANDBOX_CPUS=$(sandbox_limit "$slug" CPUS) \
  SANDBOX_HOST_KEY_VOLUME=$(host_key_volume "$slug") \
  WORK_VOLUME=$(work_volume "$slug") \
  WORK_NETWORK=$(work_network "$slug") \
  EXIT_NAME=$(exit_container "$slug") \
  SCREEN_DRIVER_NAME=$(screen_driver_container "$slug") \
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
  # The Company's own sandbox limits (#396) stay when the file is written again, as each run writes the first Engine's,
  # with the default its memory limit was written under (#711), so an update does not raise the Owner's own limit again.
  kept=$(grep -E '^SANDBOX_(MEMORY|CPUS|MEMORY_DEFAULT)=' "$folder/.env" 2> /dev/null || true)
  {
    printf 'ENGINE_NAME=%s\n' "$(engine_project "$slug")" &&
    printf 'ENGINE_KEY=%s\n' "$key" &&
    printf 'ENGINE_VOLUME=%s\n' "$volume" &&
    printf 'ENGINE_NETWORK=%s\n' "$network" &&
    { [ -z "$kept" ] || printf '%s\n' "$kept"; }
  } > "$folder/.env.tmp" || return 1
  chmod 600 "$folder/.env.tmp" || return 1
  mv "$folder/.env.tmp" "$folder/.env" || return 1
}
# A container from the one-Hermes install (before ADR 0018) is not part of this compose file any more. It must stop
# before the Engine template uses the same volume, and its volume is the first Engine's data. It is stopped, never
# removed, until the first Company's Engine answers (#502): an update whose new Engine or work sandbox does not start
# starts it again (restore_old_engine), on the networks Docker kept for it, so the previous release's app and worker keep
# their Engine. Its id is kept under .install-lock, with the sandbox parts the install has (keep_sandbox_parts) when no
# earlier step listed them, before anything of a sandbox is made.
stop_old_engine() {
  old=$(docker ps -aq --filter 'label=com.docker.compose.project=gtmworks-install' \
    --filter 'label=com.docker.compose.service=hermes') || return 1
  [ -n "$old" ] || return 0
  # An install that already had its Engine folder before this run, whose old container is stopped, is not that release:
  # an earlier run moved its Engine and left the container it could not remove (remove_old_engine). That container goes
  # now, and is never what a failed start brings back. One still running is that release's Engine, whatever the folder.
  running=$(docker ps -q --filter 'label=com.docker.compose.project=gtmworks-install' \
    --filter 'label=com.docker.compose.service=hermes') || return 1
  if [ "$1" != yes ] && [ -z "$running" ]; then
    docker rm -f $old > /dev/null \
      || echo "The previous release's Engine container is stopped but could not be removed; the next install run removes it." >&2
    return 0
  fi
  [ -f .install-lock/previous-engine/sandbox-parts ] || { mkdir -p .install-lock/previous-engine && keep_sandbox_parts; } || return 1
  printf '%s\n' $old > .install-lock/old-engine || return 1
  docker stop $old > /dev/null || return 1
}
# The old container goes once the first Company's Engine answers in its place. A removal Docker refuses fails nothing: the
# new Engine serves, and the next run finds the stopped container by its labels and removes it then.
remove_old_engine() {
  [ -f .install-lock/old-engine ] || return 0
  docker rm -f $(cat .install-lock/old-engine) > /dev/null \
    || echo "The previous release's Engine container is stopped but could not be removed; the next install run removes it." >&2
  rm -f .install-lock/old-engine
}
# The app and the worker reach every Engine by its container name. Compose recreates them on an update, which drops the
# extra networks, so each connection is made again after every start of the stack. The app answers on each Engine's
# network as `web`, the name its own scripts use there (`http://web:8080/v1`), so a probe or a model server on that
# network reaches it without a second address; the worker needs no name there. An install made before this name keeps
# its connection and joins again with it.
join_engine_network() {
  network=$1
  test -n "$network" || return 0
  # The installer's Compose file names every Engine network there is now (#773), this one included, so a recreate by any
  # Compose command that reads it keeps the app and the worker on it.
  write_engines_file || return 1
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
  raise_sandbox_memory "$1" || return 1
  engine "$1" up -d --wait --wait-timeout "$wait" || return 1
  container=$(engine_project "$1")
  healthy_within "$container" "$wait" || { echo "The Engine $container did not become healthy." >&2; return 1; }
}
# Zero once the container reports healthy, within the seconds given.
healthy_within() {
  seconds=$2
  while [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2> /dev/null)" != healthy ]; do
    seconds=$((seconds-1))
    [ "$seconds" -gt 0 ] || return 1
    sleep 1
  done
}
# One Engine stopped and removed with everything it made. Its folder and record go too; a record's removal is the caller's
# (it needs the database) and only ever a record no Company names.
engine_destroy() {
  slug=$1 volume=$2 network=$3
  engine "$slug" down -v --remove-orphans > /dev/null 2>&1 || true
  docker rm -f "$(engine_project "$slug")" "$(sandbox_container "$slug")" "$(exit_container "$slug")" "$(screen_driver_container "$slug")" > /dev/null 2>&1 || true
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
  # Whether the install is still the release before ADR 0018's own shape, read before its key moves into the folder.
  single_engine=no
  [ -f "$(engine_folder first)/.env" ] || single_engine=yes
  adopt_engine_key || return 1
  key=$(engine_key)
  test -n "$key" || { echo 'The install has no Engine key: run sh scripts/install.sh.' >&2; return 1; }
  stop_old_engine "$single_engine" || return 1
  engine_start first || return 1
  join_engine_network gtmworks-engine-first || return 1
  remove_old_engine
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
# The previous release's own Engine files, kept when an update starts and before anything replaces them (ADR 0023): an
# update whose Engines or work sandboxes do not all start puts them back, and so does one that fails before its Engines
# start (#554). Nothing is kept for an install that has none.
keep_previous_engine() {
  mkdir -p .install-lock/previous-engine
  for file in scripts/engine-*; do
    [ -f "$file" ] || continue
    cp "$file" .install-lock/previous-engine/ || return 1
  done
  keep_previous_release || return 1
  keep_sandbox_parts
}
# The release the install records it runs, kept beside the previous Engine files (#583; its name is no engine-* file, so
# it never goes to scripts/): a release update removes the record while its files are on disk, and an update whose Engines
# go back records that release again once they all run, so its own installer backs up and restores without the update
# that just failed. A run that fails before its Engines start, or whose Engines do not all come back, records none: the
# files on disk stay the failed release's until an update with either release's files runs.
keep_previous_release() {
  [ ! -f .install-release ] || cp .install-release .install-lock/previous-engine/install-release
}
previous_release_recorded_again() {
  [ ! -f .install-lock/previous-engine/install-release ] || cp .install-lock/previous-engine/install-release .install-release
}
# The previous release's own Engine files back on disk, exactly as keep_previous_engine kept them (#554): each one kept
# comes back and every other scripts/engine-* the update brought goes, so that release's Engines, its `company add`, its
# restore and the next update's keep_previous_engine read its own template; an install whose previous release had none
# is left with none. The work sandbox image this run made is dropped, and when this run rebuilt a source build's tag, the
# previous image, kept under its own name, gets the tag back. Nothing changes when no update kept the files.
previous_engine_files_back() { previous_engine_files_kept_back && new_engine_files_removed; }
previous_engine_files_kept_back() {
  [ -d .install-lock/previous-engine ] || return 0
  for file in .install-lock/previous-engine/engine-*; do
    [ -f "$file" ] || continue
    cp "$file" scripts/ || return 1
  done
  rm -f .install-lock/work-sandbox-image
  if [ -f .install-lock/work-sandbox-rebuilt ] && [ "$(cat .work-sandbox-image 2> /dev/null)" = "$work_sandbox_tag" ]; then
    docker tag "$work_sandbox_tag-previous" "$work_sandbox_tag" || return 1
  fi
}
# The Engine files the update brought go only once no Engine of this release can start again on them: a container that
# restarts with a bind source gone gets a folder Docker makes in its place, which the next update cannot copy over. That
# empty folder goes too, as nothing of the previous release is ever a folder there.
new_engine_files_removed() {
  [ -d .install-lock/previous-engine ] || return 0
  for file in scripts/engine-*; do
    [ -e "$file" ] || continue
    [ ! -f ".install-lock/previous-engine/${file#scripts/}" ] || continue
    if [ -d "$file" ]; then rmdir "$file" || return 1; else rm -f "$file" || return 1; fi
  done
}
# The work sandboxes' volumes and networks the install already has, listed beside the kept Engine files before the update
# makes anything (#479), so an update that goes back removes only the ones it made itself. A list Docker could not give
# stops the update before anything changes: an empty list read as "none existed" would remove what was there.
keep_sandbox_parts() {
  volumes=$(docker volume ls -q) || return 1
  networks=$(docker network ls --format '{{.Name}}') || return 1
  # A work folder and its work network share one name, so each line says which it is.
  { printf '%s\n' "$volumes" | sed -n -e 's/^gtmworks-work-/volume &/p' -e 's/^gtmworks-sandbox-hostkey-/volume &/p'
    printf '%s\n' "$networks" | sed -n -e 's/^gtmworks-work-/network &/p' -e 's/^gtmworks-exit-/network &/p'; } > .install-lock/previous-engine/sandbox-parts
}
# What a failed update made for the work sandboxes, removed once the previous release's Engines are back (#479), when that
# release runs none (it recorded no sandbox image): every Company's sandbox and exit container, the sandbox key this
# update made in an Engine's volume (so the next update copies that Engine's old Library into its work folder again, as
# sandbox_keys does for an Engine with no key), and each work folder, host-key volume, work network and exit network
# the install did not have when the update began. A previous release that runs sandboxes has just started its own from
# these parts, so they stay. What Docker would not remove is named, with how to remove it; the Engines that came back
# keep serving either way.
remove_new_sandbox_parts() {
  record=.install-lock/previous-engine/sandbox-parts
  [ -z "$(work_sandbox_ref)" ] || return 0
  left=
  for name in $(engine_names); do
    docker rm -f "$(sandbox_container "$name")" "$(exit_container "$name")" "$(screen_driver_container "$name")" > /dev/null 2>&1 || true
    if grep -qxF "$name" .install-lock/sandbox-keys-made 2> /dev/null; then
      volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$(engine_folder "$name")/.env")
      if [ -n "$volume" ]; then
        # The node image the installer already ran: a host that cannot pull still has it.
        docker run --rm --user 0 --entrypoint sh -v "$volume:/data" "$node_image" -ec '
          rm -rf /data/ssh
          if [ -f /data/.ssh/known_hosts ]; then
            grep -v "^\[sandbox\]:2222 " /data/.ssh/known_hosts > /data/.ssh/known_hosts.kept || true
            if [ -s /data/.ssh/known_hosts.kept ]; then cat /data/.ssh/known_hosts.kept > /data/.ssh/known_hosts; else rm -f /data/.ssh/known_hosts; fi
            rm -f /data/.ssh/known_hosts.kept
            rmdir /data/.ssh 2> /dev/null || true
          fi' > /dev/null 2>&1 || left="$left the folder ssh in the volume $volume (docker run --rm -v $volume:/data $node_image rm -rf /data/ssh),"
      fi
    fi
    # An update begun with no list removes no volume or network it cannot tell apart.
    [ -f "$record" ] || continue
    for part in "$(work_volume "$name")" "$(host_key_volume "$name")"; do
      grep -qxF "volume $part" "$record" || ! docker volume inspect "$part" > /dev/null 2>&1 \
        || docker volume rm "$part" > /dev/null 2>&1 || left="$left the volume $part (docker volume rm $part),"
    done
    for part in "$(work_network "$name")" "$(exit_network "$name")"; do
      grep -qxF "network $part" "$record" || ! docker network inspect "$part" > /dev/null 2>&1 \
        || docker network rm "$part" > /dev/null 2>&1 || left="$left the network $part (docker network rm $part),"
    done
  done
  [ -z "$left" ] || echo "What this update made for the work sandboxes could not all be removed, and an update run again keeps it as it is: remove${left%,}; then run the update again." >&2
}
# A run from the release before ADR 0018 whose first Company's Engine or work sandbox did not start (#502): that release
# shipped no Engine template to put back, and its one Engine is the `hermes` container stop_old_engine kept. The Engine the
# template made goes first, with its sandbox and exit but never its data volume, which is the old Engine's; what it made
# for the sandbox goes as remove_new_sandbox_parts removes it. The old container then starts on the networks Docker kept,
# answering as `hermes` to the app and the worker that were never replaced, and the install is that release's own shape
# again: the key back in .env.install and no Engine folder. Non-zero, with the old container left stopped, when the new
# Engine is still there to write its volume, or when the old one does not start or become healthy.
restore_old_engine() {
  old_engine=$(cat .install-lock/old-engine)
  rm -f .install-lock/work-sandbox-image
  engine first down --remove-orphans > /dev/null 2>&1 || true
  docker rm -f "$(engine_project first)" "$(sandbox_container first)" "$(exit_container first)" "$(screen_driver_container first)" > /dev/null 2>&1 || true
  # A listing Docker could not give is never read as "removed": both Engines would write the one volume.
  left_engine=$(docker ps -aq --filter "name=^$(engine_project first)\$" 2> /dev/null) \
    || { echo "Docker could not say whether the Engine $(engine_project first) is gone, so the previous release's Engine stays stopped." >&2; return 1; }
  [ -z "$left_engine" ] \
    || { echo "The Engine $(engine_project first) could not be removed, so the previous release's Engine stays stopped." >&2; return 1; }
  # No Engine of this release is left to restart on the files it brought (#554); that release shipped none.
  new_engine_files_removed || return 1
  first_network=$(engine_network_of first)
  for service in web worker; do
    id=$(compose ps -q "$service" 2> /dev/null || true)
    [ -z "$id" ] || docker network disconnect -f "$first_network" "$id" > /dev/null 2>&1 || true
  done
  docker network rm "$first_network" > /dev/null 2>&1 || true
  remove_new_sandbox_parts
  # The previous release's own shape before its Engine starts, so a start that fails leaves that shape too: its installer
  # reads the Engine key from .env.install, as its app and worker, never replaced, already hold it in their environment;
  # no container of this release reads that file's key (#378, C7 still holds for every Engine folder).
  old_key=$(engine_key first)
  if [ -n "$old_key" ] && ! grep -q '^HERMES_API_KEY=' .env.install; then
    { cat .env.install && printf 'HERMES_API_KEY=%s\n' "$old_key"; } > .install-lock/env.tmp || return 1
    chmod 600 .install-lock/env.tmp || return 1
    mv .install-lock/env.tmp .env.install || return 1
  fi
  rm -rf "$(engine_folder first)"
  rmdir .engines 2> /dev/null || true
  rm -f .install-lock/old-engine
  docker start $old_engine > /dev/null || return 1
  # The previous release's own wait: its Engine's health check allows a two-minute start and five minutes in all.
  for id in $old_engine; do
    healthy_within "$id" 300 || { echo "The previous release's Engine did not become healthy again." >&2; return 1; }
  done
}
# An update whose Engines or work sandboxes did not all start (ADR 0023): the previous release's own Engine files go back,
# and every Engine starts again from them, without the containers this release's template added beside it (each
# Company's sandbox and exit). The previous release's app and worker were never replaced and keep serving, on a schema it
# was built for, since the cutover had not run; their networks to each Engine are the Engines' own and stay. Non-zero when
# there were no files to put back or an Engine did not start from them.
restore_previous_engine() {
  if [ -f .install-lock/old-engine ]; then restore_old_engine; return; fi
  [ -f .install-lock/previous-engine/engine-template.yml ] || return 1
  # The sandboxes start again from the image the previous run recorded, never the one this run made: a release names it
  # by digest, and a source build kept it under the -previous name before rebuilding the tag. The files this release
  # brought stay until every Engine runs from the previous ones, as an Engine of this release may restart meanwhile.
  previous_engine_files_kept_back || return 1
  restored=0
  for name in $(engine_names); do
    # Each sandbox gets its own Engine's key again, as engine_start gives it: the key last read belongs to another Company.
    # A previous release from before the sandbox recorded no image and starts none, so it reads no key.
    sandbox_key=
    if [ -n "$(work_sandbox_ref)" ]; then sandbox_keys "$name" || { restored=1; continue; }; fi
    engine "$name" up -d --remove-orphans --wait --wait-timeout 300 || { restored=1; continue; }
    # A restored sandbox counts only once its own Engine reaches it over SSH: its health check sees the port, not the key.
    if [ -n "$sandbox_key" ]; then sandbox_reachable "$name" > /dev/null 2>&1 || restored=1; fi
  done
  # An Engine that did not start from the previous files may still be this release's: its files then stay for it, and
  # the install command run again puts them back.
  if [ "$restored" -eq 0 ]; then new_engine_files_removed || restored=1; fi
  remove_new_sandbox_parts
  return "$restored"
}
# Every Engine stopped before its data volume is copied: a live Engine writes under its volume while the archive reads
# it, and a restore replaces what is in it (#386). An install the previous release made has no .engines/first until its
# key is adopted; its one Engine is the first one.
engine_stop() {
  for name in $(engine_names); do
    # Its sandbox too (#399): it writes the Company's work folder, which a backup copies and a restore replaces.
    docker stop "$(engine_project "$name")" "$(sandbox_container "$name")" > /dev/null 2>&1 || true
  done
  [ -f "$(engine_folder first)/.env" ] || docker stop "$(engine_project first)" > /dev/null 2>&1 || true
}
# A stop Docker did not carry out is named, and the backup stops before it copies a volume a live Engine still writes to
# (#378, C9). What was stopped starts again from the exit handler, and no archive is written.
engines_stopped() {
  running=
  for name in $(engine_names); do
    for container in "$(engine_project "$name")" "$(sandbox_container "$name")"; do
      # A container Docker does not list is stopped; one it lists but cannot report on is not known to be stopped.
      listed=$(docker ps -aq --filter "name=^${container}$" 2> /dev/null) || { running="$running $container"; continue; }
      [ -n "$listed" ] || continue
      state=$(docker inspect -f '{{.State.Running}}' "$container" 2> /dev/null) || state=unknown
      [ "$state" = false ] || running="$running $container"
    done
  done
  [ -z "$running" ] || {
    echo "This Engine or work sandbox did not stop:$running. Nothing was archived, and what was stopped starts again." >&2
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
  company_engine "$company_name" || return 1
  echo "Signing $name in to Claude on its Engine: $host. One account serves one Company."
  if [ -t 0 ]; then tty=-t; else tty=; fi
  docker exec -i $tty -u hermes "$host" hermes auth add anthropic --type oauth --no-browser
}
# The one Company a person names by id or exact name, and its Engine's container (`host`) and name (`name`), from the
# install's database. The Engine's address names its container (scripts/engine-template.yml); an address whose whole
# value is not an Engine of this install is refused.
company_engine() {
  company_name=$1
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
}

company_usage() {
  echo 'Usage: gtmworks company add --name <Company> [--owner <email>] [--memory <size>] [--cpus <number>] | gtmworks company limits <Company> [--memory <size>] [--cpus <number>] | gtmworks company link <Company> | gtmworks company list' >&2
  exit 1
}
# `gtmworks company add` (#382, #383, ADR 0018, 0019): one new Company, its Engine made from the template with its own
# volume, key and network. A named existing Person is checked before anything exists; with no --owner the Company's name is
# held behind a first-Owner link whose secret is printed once, after `#`. The Engine is made and waited on before either;
# a failure removes everything this command made, in one plain line, so the same command can be run again.
company_add() {
  company_name= owner_email= has_owner=no memory= cpus=
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) [ $# -ge 2 ] || company_usage; company_name=$2; shift;;
      --owner) [ $# -ge 2 ] || company_usage; owner_email=$2; has_owner=yes; shift;;
      --memory) [ $# -ge 2 ] || company_usage; memory=$2; shift;;
      --cpus) [ $# -ge 2 ] || company_usage; cpus=$2; shift;;
      *) company_usage;;
    esac
    shift
  done
  test -n "$company_name" || company_usage
  check_limits "$memory" "$cpus" || return 1
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
  { write_engine_env "$slug" "$key" "$volume" "$network" && write_limits "$slug" "$memory" "$cpus"; } || {
    rollback_add
    echo "Company \"$company_name\" was not made: its Engine's folder could not be written. Nothing was left behind."
    return 1
  }
  if ! engine_start "$slug" >&2; then
    rollback_add
    echo "Company \"$company_name\" was not made: its Engine or its work sandbox did not start. Nothing was left behind; run the same command again."
    return 1
  fi
  # The sandbox is part of what this command makes (#396): its Engine reaches it before anything is announced.
  if ! sandbox_reachable "$slug"; then
    rollback_add
    echo "Company \"$company_name\" was not made: its work sandbox could not be reached from its Engine. Nothing was left behind; run the same command again."
    return 1
  fi
  if ! join_engine_network "$network"; then
    rollback_add
    echo "Company \"$company_name\" was not made: the app could not join its Engine's network. Nothing was left behind; run the same command again."
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
# `gtmworks company limits <Company> [--memory <size>] [--cpus <number>]` (#396): an existing Company's sandbox limits,
# kept in its Engine's file. Only that Company's sandbox is made again with them (its Engine, its exit, its work folder
# and every other Company stay as they run), and its Engine reaches it before the command says so. A sandbox that does
# not start with the new limits is started again with its earlier ones, which its file keeps.
company_limits() {
  company_name=${1:-} memory= cpus=
  [ $# -gt 0 ] && shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --memory) [ $# -ge 2 ] || company_usage; memory=$2; shift;;
      --cpus) [ $# -ge 2 ] || company_usage; cpus=$2; shift;;
      *) company_usage;;
    esac
    shift
  done
  test -n "$company_name" && { [ -n "$memory" ] || [ -n "$cpus" ]; } || company_usage
  check_limits "$memory" "$cpus" || return 1
  if [ -f .install-restore ] && ! flock -n .install-restore true > /dev/null 2>&1; then
    echo 'A restore is running: wait for it to finish, then run this again.' >&2
    return 1
  fi
  company_engine "$company_name" || return 1
  slug=${host#gtmworks-engine-}
  test -f "$(engine_folder "$slug")/.env" || { echo "The Engine of $name has no folder on this install. Nothing was changed." >&2; return 1; }
  old_memory=$(sandbox_limit "$slug" MEMORY) old_cpus=$(sandbox_limit "$slug" CPUS)
  write_limits "$slug" "${memory:-$old_memory}" "${cpus:-$old_cpus}" || return 1
  if ! sandbox_restart "$slug" >&2; then
    write_limits "$slug" "$old_memory" "$old_cpus" || return 1
    # The earlier limits are said to run only when the sandbox started with them again and its Engine reaches it; a start
    # Docker made that the Engine cannot reach is no working sandbox either.
    if sandbox_restart "$slug" >&2; then
      echo "The limits of Company \"$name\" were not changed: its work sandbox did not start with them. It runs with its earlier limits."
    else
      echo "The limits of Company \"$name\" were not changed, and its work sandbox did not come back with its earlier limits either: it is stopped or its Engine cannot reach it. Run this command again, or the install command." >&2
    fi
    return 1
  fi
  docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$(sandbox_container "$slug")" \
    | awk -v name="$name" '{ printf "Company \"%s\": its work sandbox now has %d MiB of memory and %g CPUs.\n", name, $1/1048576, $2/1000000000 }'
}
# One Company's sandbox made again from its Engine's file, alone: the keys are read first so it keeps accepting its
# Engine's key, and the Engine reaches it before this returns.
sandbox_restart() {
  sandbox_keys "$1" || return 1
  engine "$1" up -d --no-deps --wait --wait-timeout "${GTMWORKS_ENGINE_WAIT:-300}" sandbox || return 1
  sandbox_reachable "$1"
}
# Each Company's work sandbox and its state, from the host's Docker, which the web container does not hold, after the
# lines of the given report (scripts/company-list.mjs), whose Engine line names the sandbox's Company. Non-zero when one
# is not running.
sandbox_report() {
  printf '%s\n' "$1"
  found=0
  for name in $(engine_names); do
    container=$(sandbox_container "$name")
    line=$(printf '%s\n' "$1" | grep -F "Engine http://$(engine_project "$name"):8642" | head -n 1)
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
    [ "$state" = running ] || found=1
    if [ -n "$company" ]; then
      echo "Sandbox $container: $state (Company \"$company\")"
    else
      echo "Sandbox $container: $state"
    fi
  done
  return "$found"
}
company() {
  case "${1:-}" in
    add) shift; company_add "$@";;
    limits) shift; company_limits "$@";;
    link) shift; company_link "$@";;
    list)
      report_status=0
      report=$(compose exec -T web node scripts/company-list.mjs companies) || report_status=$?
      sandbox_report "$report" || true
      return "$report_status";;
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
    # Each Company's work folder (#399), under its Engine folder's name, beside its Engine's data.
    if [ "$mode" = rw ]; then docker volume create "$(work_volume "$name")" > /dev/null || return 1; fi
    set -- -v "$(work_volume "$name"):/work/$name:$mode" "$@"
  done
  docker run --rm --volumes-from "$(compose ps -aq db)" --volumes-from "$(compose ps -aq storage)" \
    --tmpfs /engines --tmpfs /work "$@"
}
# The migrations this release carries, applied in one transaction and recorded in gtmworks_install.schema_migrations: an
# install and an update run it before the app starts, and a restore runs it on the database it just put back, so an
# archive from an earlier release never serves on a schema this release cannot read (#378, C3). It is the same block an
# update applies to a previous release's database, so that path already proves it.
#
# A migration whose name ends in _cutover is the second step of a change the release it replaces could not run against
# (ADR 0023): `apply_migrations` leaves it out, and `apply_migrations cutover` applies it alone, once this release's app
# answers and its worker runs. Every other migration keeps the database usable by the previous release, so a run that fails before
# the cutover leaves that release serving on a schema it was built for.
apply_migrations() {
  stage=${1:-}
  {
    printf '%s\n' 'select pg_advisory_xact_lock(237);' 'create schema if not exists gtmworks_install;' \
      'revoke all on schema gtmworks_install from public, anon, authenticated, service_role;' \
      'create table if not exists gtmworks_install.schema_migrations(name text primary key);' \
      'select not exists(select 1 from gtmworks_install.schema_migrations) as bootstrap \gset' \
      '\if :bootstrap' '\ir /bootstrap-grants.sql' '\endif'
    for file in supabase/migrations/*.sql; do
      case "$file" in *.verify.sql) continue;; esac
      case "$file" in
        *_cutover.sql) [ "$stage" = cutover ] || continue;;
        *) [ "$stage" != cutover ] || continue;;
      esac
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
    case "$entry" in .env.install|engines.list|var/lib/postgresql/data/*|etc/postgresql-custom/*|var/lib/storage/*|opt/data|opt/data/*|engines|engines/*|.engines|.engines/*|work|work/*) ;; *) echo 'Unrecognised backup.' >&2; return 1;; esac
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
  # Every Company's work folder (#399): an archive made by this release holds one under work/ for each Engine it holds,
  # named as that Engine's folder, and no other; an archive made before it holds none, and its Companies get empty work
  # folders. One that holds work folders for some Engines and not others, or one without its Engine, or work folders in
  # the one-Engine layout, cannot be fully restored.
  work_folders=no
  if grep -Eq '^work/' .install-lock/entries; then
    work_folders=yes
    test "$engines_layout" = yes || { echo 'Unrecognised backup.' >&2; return 1; }
    work_names=$(sed -n 's#^work/\([^/][^/]*\)/.*#\1#p' .install-lock/entries | sort -u)
    test "$work_names" = "$engine_data" || { echo "The backup does not hold a work folder for every Company's Engine." >&2; return 1; }
  fi
  # An archive is not trusted with an Engine folder's name or its whole file (#378, X2): each Engine folder is named like
  # an Engine, and only its ENGINE_KEY is taken (64 hex characters), and its Company's sandbox limits (#396) when they
  # are a size and a number of CPUs, which this installer writes from below with this release's own
  # ENGINE_NAME/ENGINE_VOLUME/ENGINE_NETWORK. A file that could point the install network or the database's volume at
  # something else is never used.
  for name in $engine_key_folders; do
    printf '%s\n' "$name" | grep -Eq '^[a-z0-9-]+$' \
      || { echo "The backup names an Engine folder that is not usable: $name" >&2; return 1; }
    engine_file=$(docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
      tar -xOzf /backup/backup.tgz ".engines/$name/.env") || return 1
    printf '%s\n' "$engine_file" | sed -n 's/^ENGINE_KEY=//p' | grep -Eqx '[a-f0-9]{64}' \
      || { echo "The backup's Engine $name has no usable key." >&2; return 1; }
    check_limits "$(printf '%s\n' "$engine_file" | sed -n 's/^SANDBOX_MEMORY=//p')" "$(printf '%s\n' "$engine_file" | sed -n 's/^SANDBOX_CPUS=//p')" \
      || { echo "The backup's Engine $name names sandbox limits that are not usable." >&2; return 1; }
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
  # The Engines start again after the copy with their sandboxes, from the image a run of this installer recorded: an
  # install with Engine folders that this installer has not updated yet has none, and is refused before anything stops.
  [ ! -f "$(engine_folder first)/.env" ] || [ -n "$(work_sandbox_ref)" ] || { echo 'This install has not been updated to this release yet: run sh scripts/install.sh update first. Nothing was stopped or archived.' >&2; exit 1; }
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
  # Every Company's work folder goes in too, under work/ by its Engine folder's name (#399), without the tool caches an
  # Agent's commands leave in it (`.cache`, `node_modules`, `__pycache__`): each one found under work/ is excluded by its
  # own path, so a file of the same name anywhere else in the archive (an upload in Storage) is kept. Caches outside the
  # work folder live on the sandbox's own disk, which nothing keeps. A restore refuses an archive with a link member, so
  # the links an Agent makes in a work folder stay out too: each symbolic link, and every name of a file with several
  # but its first, which keeps the file itself. A name inside a cache counts for none, so a file linked from a cache keeps
  # its name outside it.
  mkdir -p .engines
  volumes ro -v "$PWD/.env.install:/.env.install:ro" -v "$PWD/.engines:/.engines:ro" \
    -v "$PWD/.install-lock/engines.list:/engines.list:ro" alpine:3.21 sh -ec '
      cd /
      {
        find work -mindepth 1 -type d \( -name .cache -o -name node_modules -o -name __pycache__ \) -prune -print
        find work -mindepth 1 -type d \( -name .cache -o -name node_modules -o -name __pycache__ \) -prune -o -type l -print
        find work -mindepth 1 -type d \( -name .cache -o -name node_modules -o -name __pycache__ \) -prune -o -type f -links +1 -exec stat -c "%i %n" {} + \
          | sort -n | awk "seen[\$1]++ { sub(/^[0-9]+ /, \"\"); print }"
      } > /tmp/caches
      tar -czf - -X /tmp/caches -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage engines work .env.install .engines engines.list
    ' > .install-lock/backup.tgz
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
     engine_file=$(docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
       tar -xOzf /backup/backup.tgz ".engines/$name/.env") || exit 1
     key=$(printf '%s\n' "$engine_file" | sed -n 's/^ENGINE_KEY=//p')
     if [ "$name" = first ]; then
       write_engine_env first "$key" "$engine_volume" "$(engine_project first)"
     else
       write_engine_env "$name" "$key" "$(engine_project "$name")" "$(engine_project "$name")"
     fi
     # The Company's sandbox limits, checked with the archive above, come back with its key.
     write_limits "$name" "$(printf '%s\n' "$engine_file" | sed -n 's/^SANDBOX_MEMORY=//p')" "$(printf '%s\n' "$engine_file" | sed -n 's/^SANDBOX_CPUS=//p')" || exit 1
   done
  fi
  if [ "$engines_layout" = yes ]; then
    # One folder per Engine (#386): each Engine's volume is mounted under its folder's name, emptied, and the archive's
    # data for it goes back where its record's address finds it.
    # Each Company's work folder is emptied too, and gets the archive's when it holds one (#399).
    volumes rw -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      for folder in /engines/*/ /work/*/; do [ -d "$folder" ] || continue; find "$folder" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; done
      # Keep the image UIDs/GIDs and modes instead of resolving owners in this helper.
      if [ "$1" = yes ]; then
        tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage engines work
      else
        tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage engines
      fi
    ' sh "$work_folders"
  else
    # An archive from before this release: the first Engine is the install's one Engine, and its data is at opt/data.
    first_volume=$engine_volume
    if [ -f "$(engine_folder first)/.env" ]; then first_volume=$(sed -n 's/^ENGINE_VOLUME=//p' "$(engine_folder first)/.env"); fi
    volumes rw -v "$first_volume:/opt/data" -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      for folder in /engines/*/ /work/*/; do [ -d "$folder" ] || continue; find "$folder" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; done
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
  # The cutover (ADR 0023), once this release's app answers on the restored database and its worker runs.
  apply_migrations cutover || { echo 'The restore finished, but its cutover migrations did not apply: run the install command again.' >&2; return 1; }
  return
elif [ "$operation" = check-restore ]; then
  # get.sh runs this with the target release's own installer before it changes anything (#378, T4): the same check a
  # restore makes, and nothing is stopped, migrated or written.
  test -f "${2:-}" || { echo 'Usage: sh scripts/install.sh check-restore <archive>' >&2; exit 1; }
  check_backup "$2" || exit 1
  echo 'The backup can be restored.'
  return
elif [ "$operation" = update ] && [ -n "$release_image" ]; then
  keep_previous_engine || exit 1
  engine_files=kept
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  test -z "${2:-}" || { echo 'A release install updates to the next release: put its docker-compose.install.yml and install.sh here, then run sh install.sh update.' >&2; exit 1; }
  refuse_several_companies || return 1
elif [ "$operation" = update ] && [ "$GTMWORKS_UPDATE_DOWNLOADED" = 1 ]; then
  # The installer the update downloaded, which finishes it with its own steps: its migrations in their stages (ADR 0023),
  # its work sandbox image and keys, its Engines.
  # The run that downloaded it kept the previous release's Engine files in the scratch folder this one inherited. An
  # installer from before #479 listed no sandbox parts beside them; nothing of a sandbox is made yet, so the list is
  # made here.
  engine_files=kept
  [ -f .install-lock/previous-engine/sandbox-parts ] || keep_sandbox_parts || exit 1
elif [ "$operation" = update ]; then
  keep_previous_engine || exit 1
  engine_files=kept
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
  # The release this update downloaded finishes it with its own installer (#389): this one's steps are the previous
  # release's, which know neither the new release's migration stages nor its sandboxes. The lock, held on descriptor 9,
  # and the scratch folder with the previous Engine files pass to it; this run's exit cleanup does not run.
  GTMWORKS_UPDATE_DOWNLOADED=1 exec sh scripts/install.sh update "$ref"
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
  status=$report_status
  sandbox_report "$report" || status=1
  return "$status"
elif [ "$operation" != install ]; then
  echo 'Usage: sh scripts/install.sh [update [ref] | backup [directory] | restore <archive> | company add --name <Company> [--owner <email>] [--memory <size>] [--cpus <number>] | company limits <Company> [--memory <size>] [--cpus <number>] | company link <Company> | company list | engines]' >&2; exit 1
fi
# A plain install run on an install the previous release made (its `hermes` container, no Engine folder) moves it to this
# release as an update does, so it is refused the same way when that install holds several Companies on its one Engine,
# before anything is pulled, migrated or replaced.
if [ "$operation" = install ] && previous_release_engine; then refuse_several_companies || exit 1; fi
if [ -n "$release_image" ]; then
  docker pull "$release_image"
  # From here the files on disk belong to this release until the run finishes, so backup and restore wait for that. An
  # update whose Engines go back records the previous release again (keep_previous_release, #583).
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
# The image every Company's work sandbox runs (#392, ADR 0020): pulled from the release's pin or built from this
# checkout, and recorded before anything can make a Company's sandbox. It comes before the migrations (#397), so an
# update whose image cannot be pulled stops with the schema as it was and the release it runs still serving.
work_sandbox_image || exit 1
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
# Every Engine is made from the template before the app and the worker start, recreated when the release pins a new
# image, and left running otherwise. An update whose Engines or sandboxes do not all start puts the previous release's
# Engines back and stops before its app or worker is replaced (ADR 0023); the release before ADR 0018 had no Engine
# files, and the exit handler removes this release's after its rollback.
if [ -n "$engine_files" ]; then engine_files=rollback; fi
if ! engines_up; then
  # A plain install run on the release before ADR 0018 moves its Engine as an update does, and puts it back the same way.
  if [ "$operation" = update ] || [ -f .install-lock/old-engine ]; then
    if restore_previous_engine; then
      # The release that serves again is the one the install records (#583).
      previous_release_recorded_again || echo 'The install could not record the previous release again: run the install command with its files.' >&2
      echo 'An Engine or a work sandbox did not start, so this update stopped: the previous release keeps serving, with its own Engines again. Nothing of this release serves.' >&2
    else
      echo 'An Engine or a work sandbox did not start, and the previous release could not get its own Engines back: run the install command again.' >&2
    fi
  fi
  exit 1
fi
# Every Engine started from this release's files, which stay whatever fails next.
engine_files=
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
# The cutover (ADR 0023): the migrations the release this one replaced could not run against apply now that this release's
# app answers its health check and its worker runs in place of the previous one (the `up --wait` above fails unless it
# does). What the cutover removes only the previous release calls; this release's worker records through the first
# step's functions, which stay, so it needs no readiness of its own first. Until here a failed run left that release
# serving on the database it was built for; one that fails now leaves this release serving, and the install command
# applies them again.
apply_migrations cutover || { echo 'This release serves, but its cutover migrations did not apply: run the install command again.' >&2; exit 1; }
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
