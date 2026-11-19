#!/bin/sh
set +x
set -eu
# Read the function before an update replaces this script on disk.
main() {
# A release's install script names its image by digest (scripts/release-assets.mjs) and sits beside its compose file;
# in a source checkout this stays empty and the image is built from the checkout.
release_image=
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
  if [ "$resume" = yes ]; then compose up -d --wait --wait-timeout 300 || status=1; engines_up || status=1; fi
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
# A Company's Engine (ADR 0018) is made from the template shipped with the release, as its own Compose project: the pinned
# official Hermes image, its own data volume, its own key and its own network. The app and the worker join that network;
# the Engine joins nothing else. The installer makes the first Company's Engine; `gtmworks company add` (#382) makes a
# later Company's the same way, one folder under .engines/<slug>. An install made before ADR 0018 keeps its existing
# `hermes` volume, now under the first Engine's name, so its Agents' memory, Skills and history stay.
engine_template=scripts/engine-template.yml
engine_address=http://gtmworks-engine-first:8642
engine_management=http://gtmworks-engine-first:9119
engine_volume=gtmworks-install_hermes
engine_project() { printf 'gtmworks-engine-%s' "$1"; }
engine_folder() { printf '.engines/%s' "$1"; }
engine_container() { engine_project "$1"; }
engine() {
  slug=$1
  shift
  docker compose --project-name "$(engine_project "$slug")" --env-file "$(engine_folder "$slug")/.env" -f "$engine_template" "$@"
}
engine_key() { sed -n 's/^HERMES_API_KEY=//p' .env.install; }
write_engine_env() {
  slug=$1 key=$2 volume=$3 network=$4
  folder=$(engine_folder "$slug")
  mkdir -p "$folder"
  {
    printf 'ENGINE_NAME=%s\n' "$(engine_container "$slug")"
    printf 'ENGINE_KEY=%s\n' "$key"
    printf 'ENGINE_VOLUME=%s\n' "$volume"
    printf 'ENGINE_NETWORK=%s\n' "$network"
  } > "$folder/.env"
  chmod 600 "$folder/.env"
}
# A container from the one-Hermes install (before ADR 0018) is not part of this compose file any more. It must stop
# before the Engine template uses the same volume, and its volume is the first Engine's data.
retire_old_engine() {
  old=$(docker ps -aq --filter 'label=com.docker.compose.project=gtmworks-install' \
    --filter 'label=com.docker.compose.service=hermes') || return 1
  [ -z "$old" ] || docker rm -f $old > /dev/null
}
# The app and the worker reach every Engine by its container name. Compose recreates them on an update, which drops the
# extra networks, so each connection is made again after every start of the stack.
join_engine_network() {
  network=$1
  test -n "$network" || return 0
  for service in web worker; do
    id=$(compose ps -q "$service") || return 1
    [ -n "$id" ] || continue
    container_name=$(docker inspect -f '{{.Name}}' "$id") || return 1
    container_name=${container_name#/}
    if docker network inspect "$network" -f '{{range .Containers}}{{println .Name}}{{end}}' | grep -qx "$container_name"; then
      continue
    fi
    docker network connect "$network" "$id" || return 1
  done
}
engine_network_of() { sed -n 's/^ENGINE_NETWORK=//p' "$(engine_folder "$1")/.env"; }
join_engine_networks() {
  for folder in .engines/*/; do
    [ -f "$folder/.env" ] || continue
    join_engine_network "$(sed -n 's/^ENGINE_NETWORK=//p' "$folder/.env")" || return 1
  done
}
engine_start() { engine "$1" up -d --wait --wait-timeout "${GTMWORKS_ENGINE_WAIT:-300}"; }
# One Engine stopped and removed with everything it made. Its folder and record go too; a record's removal is the caller's
# (it needs the database) and only ever a record no Company names.
engine_destroy() {
  slug=$1 volume=$2 network=$3
  engine "$slug" down -v --remove-orphans > /dev/null 2>&1 || true
  docker rm -f "$(engine_container "$slug")" > /dev/null 2>&1 || true
  docker volume rm "$volume" > /dev/null 2>&1 || true
  # The app and the worker may have joined this Engine's network before a later step failed: detach them first, or the
  # network would be left behind and the same command run again would meet it.
  for service in web worker; do
    id=$(compose ps -q "$service" 2> /dev/null || true)
    [ -z "$id" ] || docker network disconnect -f "$network" "$id" > /dev/null 2>&1 || true
  done
  docker network rm "$network" > /dev/null 2>&1 || true
  rm -rf "$(engine_folder "$slug")"
}
engine_up() {
  key=$(engine_key)
  test -n "$key" || { echo 'The install has no Engine key: run sh scripts/install.sh.' >&2; return 1; }
  write_engine_env first "$key" gtmworks-install_hermes gtmworks-engine-first
  retire_old_engine || return 1
  engine_start first || return 1
  join_engine_network gtmworks-engine-first
}
# Every Engine the install has, the first one included: an update starts each from its own folder, so a Company's Engine
# is never left stopped by an install of the app.
engines_up() {
  engine_up || return 1
  for folder in .engines/*/; do
    slug=${folder#.engines/}
    slug=${slug%/}
    [ "$slug" != first ] || continue
    engine_start "$slug" || return 1
    join_engine_network "$(engine_network_of "$slug")" || return 1
  done
}
engine_stop() { docker stop "$(engine_container first)" > /dev/null 2>&1 || true; }
# A new Engine's key: 64 hex characters, the shape the install's own key has, generated here and kept in the Engine's own
# folder file (owner-only) and encrypted in its record. It is never printed.
new_engine_key() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
company_usage() {
  echo 'Usage: gtmworks company add --name <Company> --owner <email> | gtmworks company list' >&2
  exit 1
}
# `gtmworks company add` (#382, ADR 0018): one new Company, its Engine made from the template with its own volume, key and
# network. The Owner email is refused before anything exists; the Engine is made and waited on before the Company; a
# failure removes everything this command made, in one plain line, so the same command can be run again.
company_add() {
  company_name= owner_email=
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) [ $# -ge 2 ] || company_usage; company_name=$2; shift;;
      --owner) [ $# -ge 2 ] || company_usage; owner_email=$2; shift;;
      *) company_usage;;
    esac
    shift
  done
  test -n "$company_name" && test -n "$owner_email" || company_usage
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  # The Owner and the name are checked in the database before an Engine, a folder or a record is made.
  slug=$(compose exec -T web node scripts/company-add.mjs check --name "$company_name" --owner "$owner_email") || return 1
  slug=$(printf '%s\n' "$slug" | tail -n 1)
  case "$slug" in ''|*[!a-z0-9-]*) echo "The Company's Engine folder name is not usable: $slug" >&2; return 1;; esac
  volume=$(engine_container "$slug")
  network=$(engine_container "$slug")
  address="http://$(engine_container "$slug"):8642"
  key=$(new_engine_key)
  write_engine_env "$slug" "$key" "$volume" "$network"
  if ! engine_start "$slug" >&2 || ! join_engine_network "$network"; then
    engine_destroy "$slug" "$volume" "$network"
    echo "Company \"$company_name\" was not made: its Engine did not become healthy. Nothing was left behind; run the same command again."
    return 1
  fi
  if ! compose exec -T -e ENGINE_ADDRESS="$address" -e ENGINE_KEY="$key" web \
    node scripts/company-add.mjs add --name "$company_name" --owner "$owner_email" --address "$address"; then
    # The record and the Company are removed by the script; a waiting record the script did not reach is removed here.
    compose exec -T web node scripts/company-add.mjs drop --address "$address" > /dev/null 2>&1 || true
    engine_destroy "$slug" "$volume" "$network"
    echo "Company \"$company_name\" was not made. Nothing was left behind; run the same command again."
    return 1
  fi
  echo "Company \"$company_name\" is made on its own Engine ($(engine_container "$slug")). Its Owner is $owner_email."
}
company() {
  case "${1:-}" in
    add) shift; company_add "$@";;
    list) compose exec -T web node scripts/company-list.mjs companies;;
    *) company_usage;;
  esac
}
complete_env() {
  docker run --rm --env-file "$1" -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs missing > .install-lock/missing
  if [ -s .install-lock/missing ]; then
    if [ -n "$(tail -c 1 "$1")" ]; then echo >> "$1"; fi
    cat .install-lock/missing >> "$1"
  fi
  rm -f .install-lock/missing
}
volumes() {
  docker run --rm --volumes-from "$(compose ps -aq db)" --volumes-from "$(compose ps -aq storage)" \
    -v "$engine_volume:/opt/data" "$@"
}
operation=${1:-install}
if [ -n "$release_image" ]; then
  # Release mode replaces the install files below; a checkout's own copies of them are source code.
  test ! -e scripts/install.sh || {
    echo 'A release install runs in its own directory, not in a source checkout: run sh scripts/install.sh here.' >&2; exit 1; }
  # A compose file from another release would migrate one version and start another.
  grep -qF "image: $release_image" docker-compose.install.yml || {
    echo "docker-compose.install.yml is not from the release of $release_image: download both files of one release." >&2; exit 1; }
  # Backup and restore restart the stack without migrating, so they run only with the files of the release it runs.
  case "$operation" in backup|restore)
    test "$(cat .install-release 2>/dev/null)" = "$release_image" || {
      echo "This install does not run $release_image yet: run sh install.sh update first, or use the files of the release it runs." >&2; exit 1; };;
  esac
fi
if [ "$operation" = backup ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  destination=${2:-backups}
  mkdir -p "$destination"
  # The stack starts again after the copy, Hermes included, so an install the installer before ADR 0010 updated gains its key.
  complete_env "$PWD/.env.install"
  resume=yes
  engine_stop
  compose stop
  # BusyBox tar applies the last -C to every entry, so keep all paths under one root. The Agents' profiles, rules,
  # knowledge, skills, memory and history live only in the first Company's Engine volume (#349, ADR 0018), so opt/data
  # goes with them.
  volumes -v "$PWD/.env.install:/.env.install:ro" alpine:3.21 tar -czf - \
    -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage opt/data .env.install > .install-lock/backup.tgz
  archive="$destination/gtmworks-$(date -u +%Y%m%dT%H%M%SZ)-$$.tgz"
  mv .install-lock/backup.tgz "$archive"
  echo "Backup: $archive"
  return
elif [ "$operation" = restore ]; then
  test -f .env.install && test -f "${2:-}" || { echo 'Usage: sh scripts/install.sh restore <archive> (into an empty install)' >&2; exit 1; }
  cp "$2" .install-lock/backup.tgz
  docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
    tar -tzf /backup/backup.tgz > .install-lock/entries
  while IFS= read -r entry; do
    case "$entry" in /*|*../*|../*|*/..) echo 'Unsafe backup path.' >&2; exit 1;; esac
    case "$entry" in .env.install|var/lib/postgresql/data/*|etc/postgresql-custom/*|var/lib/storage/*|opt/data|opt/data/*) ;; *) echo 'Unrecognised backup.' >&2; exit 1;; esac
  done < .install-lock/entries
  for entry in var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install; do
    grep -Fx "$entry" .install-lock/entries >/dev/null || { echo 'Incomplete backup.' >&2; exit 1; }
  done
  # An archive from before #349 holds no opt/data: the install restores as it did, and says what the backup left out.
  hermes_data=no
  if grep -Eq '^opt/data/?$' .install-lock/entries; then hermes_data=yes; fi
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
  volumes -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
    if [ "$1" = yes ]; then
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage /opt/data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      # Keep the image UIDs/GIDs and modes instead of resolving owners in this helper.
      tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage opt/data
    else
      # An archive from before #349: the Engine volume of this empty install stays as it is.
      find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage
    fi
  ' sh "$hermes_data"
  mv .env.install.tmp .env.install
  compose up -d --force-recreate --wait --wait-timeout 300
  engines_up
  if [ "$hermes_data" = no ]; then
    echo "The Agents' Hermes data was not in this backup: their knowledge, rules, skills and memory were not restored."
  fi
  return
elif [ "$operation" = update ] && [ -n "$release_image" ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
  test -z "${2:-}" || { echo 'A release install updates to the next release: put its docker-compose.install.yml and install.sh here, then run sh install.sh update.' >&2; exit 1; }
elif [ "$operation" = update ]; then
  test -f .env.install || { echo 'Install first.' >&2; exit 1; }
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
elif [ "$operation" = company ]; then
  shift
  company "$@"
  return
elif [ "$operation" = engines ]; then
  # Every Engine's state, as `gtmworks status` reports it (scripts/get.sh). Non-zero when one does not answer.
  compose exec -T web node scripts/company-list.mjs engines
  return
elif [ "$operation" != install ]; then
  echo 'Usage: sh scripts/install.sh [update [ref] | backup [directory] | restore <archive> | company add --name <Company> --owner <email> | company list | engines]' >&2; exit 1
fi
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
{
  printf '%s\n' 'select pg_advisory_xact_lock(237);' 'create schema if not exists gtmworks_install;' \
    'revoke all on schema gtmworks_install from public, anon, authenticated, service_role;' \
    'create table if not exists gtmworks_install.schema_migrations(name text primary key);' \
    'select not exists(select 1 from gtmworks_install.schema_migrations) as bootstrap \gset' \
    '\if :bootstrap' '\ir /bootstrap-grants.sql' '\endif'
  for file in supabase/migrations/*.sql; do
    case "$file" in *.verify.sql) continue;; esac
    name=${file##*/}
    printf '%s\n' "select exists(select 1 from gtmworks_install.schema_migrations where name='$name') as applied \gset" \
      '\if :applied' '\else' "\echo Applying migration: $name" "\ir /migrations/$name" \
      "insert into gtmworks_install.schema_migrations values ('$name');" '\endif'
  done
  printf "notify pgrst, 'reload schema';\n"
} | compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction
if [ -z "$release_image" ]; then
  compose build web
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
# The install's Engine record (#380, ADR 0018): its address and key, the key encrypted with WEBHOOK_ENCRYPTION_KEY, kept in
# the database for the app and the worker to answer from. The installer passes the Engine's own address and key to this
# script alone; they are not in the app's or the worker's environment. A fresh install leaves one record waiting for
# first run's first Company; an install made before it attaches every Company it already has, so nothing stops working.
compose exec -T -e BUNDLED_HERMES_URL="$engine_address" -e HERMES_API_KEY="$(engine_key)" web node scripts/install-engine.mjs
# Each address must answer 200. Right after the migrations PostgREST reloads its schema cache (and the gateway its
# configuration), and the app's health answers 503 meanwhile: the probes try again once a second, 60 tries in all, and
# fail naming the address and its last answer when 200 never comes.
compose exec -T web node -e "let tries=60; for(const url of ['http://gateway:8080/api/health','http://gateway:8080/sign-in','$engine_address/health']) { for(;;) { let answer; try { answer=(await fetch(url)).status; } catch(error) { answer=error.message; } if(answer===200) { console.log(url+' 200'); break; } if(--tries<=0) throw new Error(url+' returned '+answer); await new Promise(resolve=>setTimeout(resolve,1000)); } }" --input-type=module
if [ -n "$release_image" ]; then printf '%s\n' "$release_image" > .install-release; fi
# Whether first run is still open, asked through the app's service role; it answers open or closed and nothing else.
setup=$(compose exec -T web node -e "const key=process.env.SUPABASE_SERVICE_ROLE_KEY; const response=await fetch('http://gateway:8080/rest/v1/rpc/setup_is_open',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key}}); if(!response.ok) throw new Error('setup_is_open returned '+response.status); console.log(await response.json()===true?'open':'closed');" --input-type=module)
echo 'Mail: http://localhost:8025'
echo 'Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory. A company still on the shared default profile from an earlier install shares that memory, so an agent can repeat facts from one company to people in another until it moves.'
# The last line: the one-time setup link while first run is open (issue #50), the sign-in address after.
docker run --rm --env-file .env.install -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs ready "$setup"
exit 0
}
main "$@"
