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
mkdir .install-lock || { echo 'Another install is running (or remove stale .install-lock).' >&2; exit 1; }
resume=no
cleanup() {
  status=$?
  trap - EXIT
  if [ "$resume" = yes ]; then compose up -d --wait --wait-timeout 300 || status=1; fi
  rm -f .env.install.tmp
  rm -rf .install-lock
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
node_image=node:22.14.0-alpine3.21
compose() { docker compose --env-file .env.install -f docker-compose.install.yml "$@"; }
complete_env() {
  docker run --rm --env-file "$1" -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs missing > .install-lock/missing
  if [ -s .install-lock/missing ]; then
    if [ -n "$(tail -c 1 "$1")" ]; then echo >> "$1"; fi
    cat .install-lock/missing >> "$1"
  fi
  rm -f .install-lock/missing
}
volumes() {
  docker run --rm --volumes-from "$(compose ps -aq db)" --volumes-from "$(compose ps -aq storage)" "$@"
}
operation=${1:-install}
if [ -n "$release_image" ]; then
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
  compose stop
  # BusyBox tar applies the last -C to every entry, so keep all paths under one root.
  volumes -v "$PWD/.env.install:/.env.install:ro" alpine:3.21 tar -czf - \
    -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage .env.install > .install-lock/backup.tgz
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
    case "$entry" in .env.install|var/lib/postgresql/data/*|etc/postgresql-custom/*|var/lib/storage/*) ;; *) echo 'Unrecognised backup.' >&2; exit 1;; esac
  done < .install-lock/entries
  for entry in var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install; do
    grep -Fx "$entry" .install-lock/entries >/dev/null || { echo 'Incomplete backup.' >&2; exit 1; }
  done
  docker run --rm -v "$PWD/.install-lock:/backup:ro" alpine:3.21 \
    tar -xOzf /backup/backup.tgz .env.install > .env.install.tmp
  complete_env "$PWD/.env.install.tmp"
  docker run --rm --env-file .env.install.tmp -v "$PWD/lib:/code:ro" "$node_image" node /code/install-env.mjs validate complete
  resume=yes
  compose stop web worker gateway auth rest storage mail
  empty=$(compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c \
    'select not exists(select 1 from public.companies) and not exists(select 1 from auth.users) and not exists(select 1 from storage.objects);')
  test "$empty" = t || { echo 'Restore requires an empty install.' >&2; exit 1; }
  compose stop db
  # A failed extraction must stay offline, rather than start a partially restored database.
  resume=no
  volumes -v "$PWD/.install-lock:/backup:ro" alpine:3.21 sh -ec '
    find /var/lib/postgresql/data /etc/postgresql-custom /var/lib/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    # Keep the image UIDs/GIDs and modes instead of resolving owners in this helper.
    tar -xzpf /backup/backup.tgz --numeric-owner -C / var/lib/postgresql/data etc/postgresql-custom var/lib/storage
  '
  mv .env.install.tmp .env.install
  compose up -d --force-recreate --wait --wait-timeout 300
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
elif [ "$operation" != install ]; then
  echo 'Usage: sh scripts/install.sh [update [ref] | backup [directory] | restore <archive>]' >&2; exit 1
fi
if [ -n "$release_image" ]; then
  docker pull "$release_image"
  # The image carries what a checkout holds for the install: migrations, database and gateway files, lib/install-env.mjs.
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/install" "$release_image" cp -R /app/install/. /install/
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
if [ -z "$release_image" ]; then compose build web; fi
if [ "$operation" = update ]; then
  compose up -d --no-deps --wait --wait-timeout 300 hermes web worker
else
  compose up -d --wait --wait-timeout 300
fi
compose exec -T web node -e "for(const url of ['http://gateway:8080/api/health','http://gateway:8080/sign-in','http://hermes:8642/health']) { const response=await fetch(url); if(response.status!==200) throw new Error(url+' returned '+response.status); console.log(url+' '+response.status); }" --input-type=module
if [ -n "$release_image" ]; then printf '%s\n' "$release_image" > .install-release; fi
echo 'gtmworks is ready: http://localhost:3000/sign-in (mail: http://localhost:8025)'
echo 'One install serves one company until each company gets its own agent engine home: companies on the bundled agent engine share one agent memory, so an agent can repeat facts from one company to people in another.'
exit 0
}
main "$@"
