#!/bin/sh
# gtmworks get.sh: the one-line installer, and the gtmworks command it leaves behind (#51, #52).
#
#   curl -fsSL https://raw.githubusercontent.com/omarabdo516/gtmworks/main/scripts/get.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/omarabdo516/gtmworks/main/scripts/get.sh | sh -s -- --version vX.Y.Z
#
# It downloads one release's two files (docker-compose.install.yml and install.sh, the GitHub Release assets of #49)
# into the install folder and runs that install.sh, which pulls the images by digest, applies the migrations from the
# image and starts gtmworks; nothing is built and no source is downloaded. It keeps a copy of itself in the folder as
# gtmworks.sh and puts a `gtmworks` command in ~/.local/bin that runs it:
#   gtmworks status | update | backup | restore <archive> | install
#
# The latest stable release is the highest published vX.Y.Z, the release the stable image tag follows. `--channel main`
# installs the newest main image instead: main publishes no GitHub Release, so its two files are written by
# scripts/release-assets.mjs from inside that image (Dockerfile, /app/release-source), for the digest just pulled.
#
# Tests only: GTMWORKS_RELEASES replaces GitHub Releases with a base URL (file:// in CI) that holds releases.json (a list
# of {"tag_name": "vX.Y.Z"}) and <tag>/<file> for each release; GTMWORKS_GET replaces the address this script copies
# itself from when it runs from a pipe.
set +x
set -eu
# Read whole before anything runs: a pipe that breaks off, or a copy replaced on disk, cannot run half a script.
main() {
repository=omarabdo516/gtmworks
image=ghcr.io/$repository
marker='# gtmworks get.sh: the one-line installer, and the gtmworks command it leaves behind (#51, #52).'
releases=${GTMWORKS_RELEASES:-}
get_url=${GTMWORKS_GET:-https://raw.githubusercontent.com/$repository/main/scripts/get.sh}
line="curl -fsSL https://raw.githubusercontent.com/$repository/main/scripts/get.sh | sh"
# This script's own file, when it runs from one (the gtmworks command, or sh get.sh); a pipe has none.
self=$0
case "$self" in /*) ;; *) self=$PWD/$self;; esac

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
usage() {
  cat >&2 <<USAGE
Usage:
  $line -s -- [--version vX.Y.Z | --channel main] [--dir <folder>]
  gtmworks status
  gtmworks update [--version vX.Y.Z | --channel main] [--no-backup]
  gtmworks backup
  gtmworks restore <archive> [--version vX.Y.Z]
  gtmworks install          (repair: the same as running the line again)
USAGE
  exit "${1:-2}"
}
wrong() { printf '%s\n' "$*" >&2; usage; }

command_mode=no operation= archive= version= channel= dir= backup=yes
while [ $# -gt 0 ]; do
  case "$1" in
    --command) command_mode=yes;;
    --version|--channel|--dir) [ $# -ge 2 ] || wrong "$1 needs a value."
      case "$1" in --version) version=$2;; --channel) channel=$2;; --dir) dir=$2;; esac; shift;;
    --version=*) version=${1#*=};;
    --channel=*) channel=${1#*=};;
    --dir=*) dir=${1#*=};;
    --no-backup) backup=no;;
    -h|--help|help) usage 0;;
    -*) wrong "Unknown option: $1";;
    *) if [ -z "$operation" ]; then operation=$1
       elif [ "$operation" = restore ] && [ -z "$archive" ]; then archive=$1
       else wrong "Unexpected argument: $1"; fi;;
  esac
  shift
done
# The line installs; the gtmworks command does what it is told and nothing when told nothing.
if [ -z "$operation" ]; then [ "$command_mode" = no ] || usage; operation=install; fi
case "$operation" in install|update|backup|restore|status) ;; *) wrong "Unknown command: $operation";; esac
if [ -n "$version" ] && ! printf '%s\n' "$version" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+'; then
  wrong "--version takes a release version such as v1.2.3, not $version."
fi
case "$channel" in ''|stable|main) ;; *) wrong "--channel is stable or main, not $channel.";; esac
[ -z "$version" ] || [ "$channel" != main ] || wrong '--version names a stable release; it cannot be combined with --channel main.'
[ "$backup" = yes ] || [ "$operation" = update ] || wrong '--no-backup belongs to gtmworks update.'
[ -z "$channel" ] || [ "$operation" = install ] || [ "$operation" = update ] || wrong "--channel belongs to the install and to gtmworks update."
case "$operation" in install|update|restore) ;; *) [ -z "$version" ] || wrong "--version does not apply to gtmworks $operation.";; esac
[ "$operation" != restore ] || [ -n "$archive" ] || wrong 'gtmworks restore needs the backup archive to restore.'
if [ -z "$dir" ]; then
  [ -n "${HOME:-}" ] || fail 'HOME is not set: name the install folder with --dir <folder>.'
  dir=$HOME/gtmworks
fi
case "$dir" in /*) ;; *) dir=$PWD/$dir;; esac

# Every check here only reads: a machine that fails one is left exactly as it was.
check_prerequisites() {
  command -v docker > /dev/null 2>&1 || fail "gtmworks needs Docker, which is not installed on this machine. Install Docker Engine (https://docs.docker.com/engine/install/), then run this again. Nothing was changed."
  found=$(docker compose version --short 2> /dev/null) || found=
  found=${found#v}
  major=${found%%.*} rest=${found#*.}
  minor=${rest%%.*}
  case "$found" in
    *.*) case "$major$minor" in ''|*[!0-9]*) recent=no;;
           *) if [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 20 ]; }; then recent=yes; else recent=no; fi;; esac;;
    *) recent=no;;
  esac
  [ "$recent" = yes ] || fail "gtmworks needs Docker Compose v2.20 or newer (the docker compose plugin); this machine has ${found:-none}. Install or update it (https://docs.docker.com/compose/install/linux/), then run this again. Nothing was changed."
  docker info > /dev/null 2>&1 || fail "Docker is installed, but this user cannot reach it. Start Docker, or add this user to the docker group (sudo usermod -aG docker \$USER) and sign in again, then run this again. Nothing was changed."
}
need_curl() {
  command -v curl > /dev/null 2>&1 || fail "gtmworks needs curl to download its release files. Install curl, then run this again. Nothing was changed."
}
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
compose() { docker compose --env-file .env.install -f docker-compose.install.yml "$@"; }
# The install script is read from its own file, never from this script's pipe.
run_installer() { sh ./install.sh "$@" < /dev/null; }
recorded() { sed -n '1{/^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$/p;/^main$/p;}' "$dir/.gtmworks-version" 2> /dev/null || true; }
database_migrations() {
  compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
    -c 'select name from gtmworks_install.schema_migrations order by name' < /dev/null
}
# Each name the database has applied that the image does not carry, one per line.
missing_from() {
  printf '%s\n' "$2" | while IFS= read -r name; do
    [ -z "$name" ] || printf '%s\n' "$1" | grep -Fqx -- "$name" || printf '%s\n' "$name"
  done
}

stage=
cleanup() { status=$?; trap - EXIT; [ -z "$stage" ] || rm -rf "$stage"; exit "$status"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
new_stage() { stage=$(mktemp -d "$dir/.gtmworks-download.XXXXXX"); }

fetch() { curl -fsSL --retry 3 -o "$2" "$1" || fail "Could not download $1. Check this machine's internet access, then run this again."; }
latest_release() {
  if [ -n "$releases" ]; then list_url=$releases/releases.json; else list_url="https://api.github.com/repos/$repository/releases?per_page=100"; fi
  list=$(curl -fsSL --retry 3 "$list_url") || fail "Could not read the list of gtmworks releases ($list_url). Name one with --version vX.Y.Z, or try again later."
  latest=$(printf '%s\n' "$list" | tr ',' '\n' \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' \
    | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  [ -n "$latest" ] || fail "No gtmworks release is published yet ($list_url). Use --channel main for the newest main build."
  printf 'v%s\n' "$latest"
}
# Both files of one release, checked against each other: install.sh names one image by digest, and the compose file
# runs that image. Sets release_ref.
check_assets() {
  [ "$(grep -c '^release_image=' "$1/install.sh" || true)" = 1 ] || fail "The downloaded install.sh is not a gtmworks release install script."
  release_ref=$(sed -n 's/^release_image=//p' "$1/install.sh")
  case "$release_ref" in *@sha256:*) ;; *) fail "The downloaded install.sh names no image by digest: $release_ref";; esac
  grep -qF "image: $release_ref" "$1/docker-compose.install.yml" \
    || fail "The downloaded docker-compose.install.yml is not from the release of $release_ref."
}
download_release() {
  if [ "$1" = main ]; then
    say "Pulling the newest main build: $image:main"
    docker pull "$image:main"
    digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image:main" \
      | sed -n "s#^$image@\(sha256:[a-f0-9]\{64\}\)\$#\1#p" | head -n 1)
    [ -n "$digest" ] || fail "Could not read the digest of $image:main."
    ref=$image:main@$digest
    docker run --rm --user "$(id -u):$(id -g)" -v "$2:/out" -w /app/release-source "$ref" \
      node scripts/release-assets.mjs "$ref" /out \
      || fail "The main build $ref cannot write its install files (it predates the main channel). Install a release instead."
  else
    base=${releases:-https://github.com/$repository/releases/download}
    for file in docker-compose.install.yml install.sh; do fetch "$base/$1/$file" "$2/$file"; done
  fi
  check_assets "$2"
}
place_release() { mv "$1/docker-compose.install.yml" docker-compose.install.yml; mv "$1/install.sh" install.sh; }
in_install() {
  [ -f "$dir/.env.install" ] && [ -f "$dir/install.sh" ] && [ -f "$dir/docker-compose.install.yml" ] \
    || fail "There is no gtmworks install in $dir. Install it with: $line"
  cd "$dir"
}
take_backup() {
  run_installer backup "$dir/backups" > "$stage/backup.log" 2>&1 || { cat "$stage/backup.log" >&2; return 1; }
  grep -v '^Backup: ' "$stage/backup.log" || true
  archive_made=$(sed -n 's/^Backup: //p' "$stage/backup.log" | tail -n 1)
  [ -f "$archive_made" ] || { echo "The backup wrote no archive." >&2; return 1; }
}

# The command on the PATH runs the copy of this script kept in the install folder, for that folder.
install_command() {
  if [ -f "$self" ] && [ "$(sed -n 2p "$self")" = "$marker" ]; then cp "$self" gtmworks.sh.tmp; else fetch "$get_url" gtmworks.sh.tmp; fi
  [ "$(sed -n 2p gtmworks.sh.tmp)" = "$marker" ] || { rm -f gtmworks.sh.tmp; fail "$get_url is not the gtmworks installer."; }
  chmod 755 gtmworks.sh.tmp
  mv gtmworks.sh.tmp gtmworks.sh
  bin=$HOME/.local/bin
  mkdir -p "$bin"
  folder=$(quote "$dir")
  printf '%s\n' '#!/bin/sh' "# The gtmworks command, written by get.sh: it runs the copy of get.sh kept in the install folder." \
    "exec sh $folder/gtmworks.sh --command --dir $folder \"\$@\"" > "$bin/gtmworks.tmp"
  chmod 755 "$bin/gtmworks.tmp"
  mv "$bin/gtmworks.tmp" "$bin/gtmworks"
  say "The gtmworks command is $bin/gtmworks: gtmworks status, gtmworks update, gtmworks backup, gtmworks restore <archive>."
  case ":${PATH:-}:" in *":$bin:"*) return;; esac
  # A profile that already names ~/.local/bin (Ubuntu's ~/.profile does) is left as it is.
  path_line='export PATH="$HOME/.local/bin:$PATH"'
  added=
  for profile in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ "$profile" = "$HOME/.profile" ] || [ -f "$profile" ] || continue
    if [ -f "$profile" ] && grep -q '\.local/bin' "$profile"; then continue; fi
    printf '\n%s\n%s\n' '# Added by the gtmworks installer: the gtmworks command lives in ~/.local/bin.' "$path_line" >> "$profile"
    added="$added $profile"
  done
  if [ -n "$added" ]; then say "Added ~/.local/bin to the PATH in:$added. Open a new shell, or run: $path_line"
  else say "Your shell profile already puts ~/.local/bin on the PATH: open a new shell to use the gtmworks command."; fi
}

op_install() {
  [ -n "${HOME:-}" ] || fail 'HOME is not set, so the gtmworks command has no ~/.local/bin to go in.'
  check_prerequisites
  need_curl
  current=$(recorded)
  requested=$version
  [ "$channel" != main ] || requested=main
  if [ -f "$dir/.env.install" ] && [ -n "$current" ]; then
    [ -z "$requested" ] || [ "$requested" = "$current" ] || fail "$dir already runs gtmworks $current. To move it to $requested, run: gtmworks update $(if [ "$requested" = main ]; then echo '--channel main'; else echo "--version $requested"; fi). Nothing was changed."
    target=$current
    say "Repairing gtmworks $target in $dir; its keys and data are kept."
  else
    target=${requested:-$(latest_release)}
    say "Installing gtmworks $target into $dir."
  fi
  mkdir -p "$dir"
  cd "$dir"
  test ! -e scripts/install.sh || fail "$dir is a source checkout: install from source with sh scripts/install.sh there, or choose another folder with --dir."
  new_stage
  if [ "$target" = main ] && [ "$current" = main ] && [ -f install.sh ] && [ -f docker-compose.install.yml ]; then
    # A repair keeps the main build it runs; moving to a newer one is an update, which backs up first.
    check_assets .
  else
    download_release "$target" "$stage"
    place_release "$stage"
  fi
  say "gtmworks $target: $release_ref"
  install_command
  run_installer
  printf '%s\n' "$target" > .gtmworks-version
}

op_update() {
  check_prerequisites
  need_curl
  in_install
  previous=$(recorded)
  running=$(cat .install-release 2> /dev/null || true)
  [ -n "$running" ] && [ "$(sed -n 's/^release_image=//p' install.sh)" = "$running" ] \
    || fail "The files in $dir are not those of the release it runs: an install or update did not finish. Repair it first with: gtmworks install. Nothing was changed."
  if [ -n "$version" ]; then target=$version
  elif [ "$channel" = main ] || { [ -z "$channel" ] && [ "$previous" = main ]; }; then target=main
  else target=$(latest_release); fi
  new_stage
  download_release "$target" "$stage"
  if [ "$release_ref" = "$running" ]; then
    printf '%s\n' "$target" > .gtmworks-version
    say "gtmworks $target ($release_ref) already runs in $dir: nothing to update."
    return
  fi
  say "Updating gtmworks ${previous:-(unrecorded)} to $target: $release_ref"
  docker pull "$release_ref"
  # Older than the data: the database holds a migration the target release does not carry, so a later release migrated
  # it. That release's schema is not one the target was built for; going back takes a backup made before it.
  applied=$(database_migrations) || fail "Could not read the database's migrations: is gtmworks running? See gtmworks status. Nothing was changed."
  carried=$(docker run --rm "$release_ref" ls /app/install/supabase/migrations) || fail "Could not read the migrations of $release_ref. Nothing was changed."
  missing=$(missing_from "$carried" "$applied" | tr '\n' ' ')
  [ -z "$missing" ] || fail "gtmworks $target is older than the data in $dir: a later release applied migrations that $target does not carry (${missing% }). Nothing was changed. To go back to $target, restore a backup made with it: gtmworks restore <archive> --version $target"
  archive=
  if [ "$backup" = yes ]; then
    say 'Backing up before the update...'
    take_backup || fail 'The backup failed, so nothing was updated.'
    archive=$archive_made
    say "Backup: $archive"
  fi
  cp docker-compose.install.yml "$stage/previous-compose.yml"
  cp install.sh "$stage/previous-install.sh"
  place_release "$stage"
  if run_installer update; then :; else
    status=$?
    say "The update to $target failed (exit $status)." >&2
    now=$(database_migrations) || now='(unreadable)'
    if [ "$now" = "$applied" ]; then
      # Its migrations rolled back, so the previous release's files go back with the schema it was serving on.
      cp "$stage/previous-compose.yml" docker-compose.install.yml
      cp "$stage/previous-install.sh" install.sh
      if run_installer update > "$stage/return.log" 2>&1; then
        say "gtmworks ${previous:-(the previous release)} keeps serving, on its own files again." >&2
      else
        cat "$stage/return.log" >&2
        say "Putting the previous release's files back did not finish: run gtmworks install." >&2
      fi
    else
      say "Its migrations may have been applied before it failed, so its files stay: run gtmworks update $(if [ "$target" = main ]; then echo '--channel main'; else echo "--version $target"; fi) --no-backup to finish it." >&2
    fi
    [ -z "$archive" ] || say "Backup: $archive" >&2
    exit "$status"
  fi
  printf '%s\n' "$target" > .gtmworks-version
  now=$(database_migrations) || now=
  say "gtmworks $target is running: $release_ref"
  [ -z "$archive" ] || say "Backup: $archive"
  if [ -z "$previous" ]; then
    say "The release this install ran before is not recorded, so there is no command to go back to it."
  elif [ "$now" = "$applied" ]; then
    say "To go back to $previous: gtmworks update $(if [ "$previous" = main ]; then echo '--channel main'; else echo "--version $previous"; fi)"
  elif [ -z "$archive" ]; then
    say "This update migrated the database and took no backup (--no-backup), so going back to $previous needs a backup made before it."
  elif [ "$previous" = main ]; then
    say "To go back: restore $archive with a release that carries its migrations: gtmworks restore $(quote "$archive") --version vX.Y.Z"
  else
    say "To go back to $previous: gtmworks restore $(quote "$archive") --version $previous"
  fi
}

op_restore() {
  check_prerequisites
  case "$archive" in /*) ;; *) archive=$PWD/$archive;; esac
  [ -f "$archive" ] || fail "There is no backup archive at $archive."
  in_install
  if [ -z "$version" ]; then run_installer restore "$archive"; return; fi
  # Going back to a release: the current data is backed up, then this install is made anew with that release's files
  # and the archive restored into it. The agent engine's volume is kept.
  need_curl
  new_stage
  download_release "$version" "$stage"
  say "Going back to gtmworks $version with the data of $archive. The current data is backed up first."
  take_backup || fail 'The backup of the current data failed, so nothing was changed.'
  say "Backup of the current data: $archive_made"
  compose down
  docker volume rm gtmworks-install_database gtmworks-install_database-config gtmworks-install_files
  place_release "$stage"
  run_installer
  run_installer restore "$archive"
  printf '%s\n' "$version" > .gtmworks-version
  say "gtmworks $version is running with the data of $archive. The data from before is in $archive_made."
}

op_backup() { check_prerequisites; in_install; run_installer backup "$dir/backups"; }

op_status() {
  check_prerequisites
  in_install
  say "gtmworks $(recorded | grep . || echo '(unrecorded version)') in $dir: $(cat .install-release 2> /dev/null || echo 'no finished install')"
  services=$(compose config --services) || fail 'Could not read the install compose file.'
  total=0 unhealthy=
  for service in $services; do
    total=$((total + 1))
    id=$(compose ps -aq "$service" 2> /dev/null || true)
    if [ -z "$id" ]; then state='not created'
    else state=$(docker inspect -f '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' "$id" 2> /dev/null || echo unknown); fi
    case "$state" in
      'running healthy') shown=healthy;;
      running) shown='healthy (running; it has no health check of its own)';;
      *) shown="NOT HEALTHY: $state"; unhealthy="$unhealthy $service";;
    esac
    printf '%-8s %s\n' "$service" "$shown"
  done
  if [ -z "$unhealthy" ]; then
    compose exec -T web node --input-type=module -e "for(const url of ['http://gateway:8080/api/health','http://gateway:8080/sign-in','http://hermes:8642/health']) { const response=await fetch(url); console.log(url+' '+response.status); if(response.status!==200) process.exitCode=1; }" < /dev/null \
      || unhealthy=' the app'
  fi
  [ -z "$unhealthy" ] || fail "Not healthy:$unhealthy. Repair with: gtmworks install"
  say "All $total services are healthy."
}

"op_$operation"
}
main "$@"
