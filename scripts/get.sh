#!/bin/sh
# gtmworks get.sh: the one-line installer, and the gtmworks command it leaves behind (#51, #52).
#
#   curl -fsSL https://raw.githubusercontent.com/omarabdo516/gtmworks/main/scripts/get.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/omarabdo516/gtmworks/main/scripts/get.sh | sh -s -- --version vX.Y.Z
#
# It downloads one release's two files (docker-compose.install.yml and install.sh, the GitHub Release assets of #49)
# into the install folder and runs that install.sh, which pulls the images by digest, applies the migrations from the
# image and starts gtmworks; nothing is built and no source is downloaded. It keeps the get.sh of the build it installs
# (the image carries it, #437) in the folder as gtmworks.sh and puts a `gtmworks` command in ~/.local/bin that runs it:
#   gtmworks status | update | backup | restore <archive> | install | sign-in claude
#   gtmworks update-button on|off | gtmworks auto-update on|off | gtmworks updater (one run of the updater, #443)
#   gtmworks company add --name <Company> [--owner <email>] [--memory <size>] [--cpus <number>] [--disk <size>]
#   gtmworks company limits <Company> [--memory <size>] [--cpus <number>] [--disk <size>] | gtmworks company link <Company>
#   gtmworks company list
#
# The latest stable release is the highest published vX.Y.Z that GitHub does not mark as a prerelease, the release the
# stable image tag follows. `--channel main` installs the newest main image instead: main publishes no GitHub Release, so
# its two files are written by scripts/release-assets.mjs from inside that image (Dockerfile, /app/release-source), for
# the digest just pulled and the work sandbox image pushed by the same run.
#
# Tests only: GTMWORKS_RELEASES replaces GitHub Releases with a base URL (file:// in CI) that holds releases.json (a list
# of {"tag_name": "vX.Y.Z"}) and <tag>/<file> for each release; GTMWORKS_GET replaces the address of main's get.sh.
set +x
set -eu
# Read whole before anything runs: a pipe that breaks off, or a copy replaced on disk, cannot run half a script.
main() {
repository=omarabdo516/gtmworks
image=ghcr.io/$repository
marker='# gtmworks get.sh: the one-line installer, and the gtmworks command it leaves behind (#51, #52).'
releases=${GTMWORKS_RELEASES:-}
# The folder of the last install the line made on this machine, named when another folder finds its data.
owner_record=${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/gtmworks/install-dir
# One update at a time on this machine: the folder the install record lives in, so two folders that share this machine's
# Docker project wait for each other. install.sh has a lock of its own for its run; this one covers the whole update.
update_lock=${owner_record%/*}/update.lock
get_url=${GTMWORKS_GET:-https://raw.githubusercontent.com/$repository/main/scripts/get.sh}
line="curl -fsSL https://raw.githubusercontent.com/$repository/main/scripts/get.sh | sh"

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
usage() {
  cat >&2 <<USAGE
Usage:
  $line -s -- [--version vX.Y.Z | --channel main] [--dir <folder>]
  gtmworks status
  gtmworks update [--version vX.Y.Z | --version main@sha256:<digest> | --channel main] [--no-backup]
  gtmworks backup [directory]
  gtmworks restore <archive> [--version vX.Y.Z | --version main@sha256:<digest> [--yes] [--no-backup]]
  gtmworks sign-in claude --company <id-or-name>
  gtmworks install          (repair: the same as running the line again)
  gtmworks company add --name <Company> [--owner <email>] [--memory <size>] [--cpus <number>] [--disk <size>]
  gtmworks company limits <Company> [--memory <size>] [--cpus <number>] [--disk <size>]  (its work sandbox's memory, CPUs and disk)
  gtmworks company link <Company>  (a fresh first-Owner link for a Company still waiting)
  gtmworks company list     (each Company, the state of its Engine and of its work sandbox)
  gtmworks update-button on|off  (the Update now button Owners see; on by default)
  gtmworks auto-update on|off    (install each newer version of this channel by itself; off by default)
  gtmworks updater          (one run of the updater; its timer runs it every minute)
USAGE
  exit "${1:-2}"
}
wrong() { printf '%s\n' "$*" >&2; usage; }

command_mode=no operation= archive= version= channel= dir= backup=yes yes=no provider= company= company_command=no setting=
destination=
while [ $# -gt 0 ]; do
  case "$1" in
    --command) command_mode=yes;;
    --version|--channel|--dir|--company) [ $# -ge 2 ] || wrong "$1 needs a value."
      case "$1" in --version) version=$2;; --channel) channel=$2;; --dir) dir=$2;; --company) company=$2;; esac; shift;;
    --version=*) version=${1#*=};;
    --channel=*) channel=${1#*=};;
    --dir=*) dir=${1#*=};;
    --company=*) company=${1#*=};;
    --no-backup) backup=no;;
    --yes) yes=yes;;
    -h|--help|help) usage 0;;
    -*) wrong "Unknown option: $1";;
    *) if [ -z "$operation" ]; then
         operation=$1
         [ "$operation" != company ] || company_command=yes
       elif [ "$company_command" = yes ]; then break
       elif [ "$operation" = restore ] && [ -z "$archive" ]; then archive=$1
       elif [ "$operation" = backup ] && [ -z "$destination" ]; then destination=$1
       elif [ "$operation" = sign-in ] && [ -z "$provider" ]; then provider=$1
       elif { [ "$operation" = update-button ] || [ "$operation" = auto-update ]; } && [ -z "$setting" ]; then setting=$1
       else wrong "Unexpected argument: $1"; fi;;
  esac
  shift
done
# The line installs; the gtmworks command does what it is told and nothing when told nothing.
if [ -z "$operation" ]; then [ "$command_mode" = no ] || usage; operation=install; fi
case "$operation" in install|update|backup|restore|status|company|sign-in|updater|update-button|auto-update) ;; *) wrong "Unknown command: $operation";; esac
case "$operation" in update-button|auto-update) case "$setting" in on|off) ;; *) wrong "gtmworks $operation takes on or off.";; esac;; esac
if [ -n "$version" ] && ! printf '%s\n' "$version" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+|main@sha256:[a-f0-9]{64}'; then
  wrong "--version takes a release version such as v1.2.3, not $version."
fi
# main@sha256:<digest> names a main build this install ran before, whose files it kept: the go-back of an update.
case "$version" in main@*) [ "$operation" = update ] || [ "$operation" = restore ] \
  || wrong "--version $version names a main build this install kept; it belongs to gtmworks update and gtmworks restore.";; esac
case "$channel" in ''|stable|main) ;; *) wrong "--channel is stable or main, not $channel.";; esac
[ -z "$version" ] || [ "$channel" != main ] || wrong '--version names a stable release; it cannot be combined with --channel main.'
# A go-back may skip its backup of the current data: the updater's, right after the update's own backup (#443).
[ "$backup" = yes ] || [ "$operation" = update ] || { [ "$operation" = restore ] && [ -n "$version" ]; } \
  || wrong '--no-backup belongs to gtmworks update and gtmworks restore --version.'
[ "$yes" = no ] || [ "$operation" = restore ] || wrong '--yes belongs to gtmworks restore.'
if [ "$operation" = sign-in ]; then
  [ "$provider" = claude ] || wrong "gtmworks sign-in signs in claude. Run: gtmworks sign-in claude --company <id-or-name>"
  [ -n "$company" ] || wrong 'gtmworks sign-in claude needs --company <id-or-name>.'
else
  [ -z "$company" ] || wrong "--company belongs to gtmworks sign-in."
fi
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
  command -v flock > /dev/null 2>&1 || fail "gtmworks needs flock to run one update at a time on this machine. It comes with util-linux, which nearly every Linux install has; install it (Debian and Ubuntu: apt install util-linux), then run this again. Nothing was changed."
}
# Held by flock from the ownership and compatibility checks through placing the release's files and recording the target:
# a second update on this machine stops here and changes nothing. flock drops the lock when this process ends, however it
# ends, so an update that was killed leaves no lock for the next one. Nothing is removed: every run opens the same file.
lock_update() {
  mkdir -p "${update_lock%/*}" 2> /dev/null \
    || fail "Could not make the folder for gtmworks's update lock (${update_lock%/*}): set HOME or XDG_STATE_HOME to a folder this user can write, then run this again. Nothing was changed."
  exec 9>"$update_lock"
  flock -n 9 || fail "Another gtmworks update is running on this machine: wait for it to finish, then run this again. Nothing was changed."
}
need_curl() {
  command -v curl > /dev/null 2>&1 || fail "gtmworks needs curl to download its release files. Install curl, then run this again. Nothing was changed."
}
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
compose() { docker compose --env-file .env.install -f docker-compose.install.yml "$@"; }
# The install script is read from its own file, never from this script's pipe.
run_installer() { sh ./install.sh "$@" < /dev/null; }
recorded() { sed -n '1{/^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$/p;/^main$/p;}' "$dir/.gtmworks-version" 2> /dev/null || true; }
# The release an update is moving to, written before it changes the install's files and removed when it finishes or its
# migrations are confirmed rolled back: an update the machine stopped in the middle of is finished by gtmworks install.
pending() { sed -n '1{/^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$/p;/^main$/p;/^main@sha256:[a-f0-9]\{64\}$/p;}' "$dir/.gtmworks-pending" 2> /dev/null || true; }
record_target() {
  case "$1" in main@*) echo main;; *) printf '%s\n' "$1";; esac > .gtmworks-version
  drop_pending
}
drop_pending() { rm -f .gtmworks-pending; rm -rf .gtmworks-pending.d; }
# The target's two files are saved before the run is recorded as pending, so an update or a first install the machine
# stopped in is finished from them (a main build pinned by its digest), whichever of the install's own files were
# swapped already. $1 is the target it records, $2 the folder holding that target's two files.
save_pending() {
  drop_pending
  rm -rf .gtmworks-pending.tmp.d
  mkdir .gtmworks-pending.tmp.d
  cp "$2/install.sh" "$2/docker-compose.install.yml" .gtmworks-pending.tmp.d/
  mv .gtmworks-pending.tmp.d .gtmworks-pending.d
  printf '%s\n' "$1" > .gtmworks-pending.tmp
  mv .gtmworks-pending.tmp .gtmworks-pending
}
# The data volume's creation time, kept in the folder whose .env.install holds the data's keys: Docker makes the volume
# anew when another install starts over, so a folder whose mark differs holds keys for data that is gone.
data_created() { docker volume inspect -f '{{.CreatedAt}}' gtmworks-install_database 2> /dev/null; }
own_data() {
  mkdir -p "${owner_record%/*}" && printf '%s\n' "$dir" > "$owner_record" || true
  created=$(data_created) && printf '%s\n' "$created" > "$dir/.gtmworks-data" || rm -f "$dir/.gtmworks-data"
}
# This folder is about to make the data anew: it is recorded as the maker before the volumes exist.
claim_data() {
  rm -f "$dir/.gtmworks-data"
  mkdir -p "${owner_record%/*}" && printf '%s\n' "$dir" > "$owner_record" || true
}
# None when the database has no migration table yet: a first install that stopped before its first migration.
database_migrations() {
  printf '%s\n' "select to_regclass('gtmworks_install.schema_migrations') is not null as present \\gset" '\if :present' \
    'select name from gtmworks_install.schema_migrations order by name;' '\endif' \
    | compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1
}
# The migrations this folder's data has applied, read before a repair changes anything: none when there is no data
# volume, and the database is started alone when it is not running.
data_migrations() {
  docker volume inspect gtmworks-install_database > /dev/null 2>&1 || return 0
  if database_migrations 2> /dev/null; then return 0; fi
  compose up -d --wait db > /dev/null 2>&1 || return 1
  database_migrations
}
# Each name the database has applied that the image does not carry, one per line.
missing_from() {
  printf '%s\n' "$2" | while IFS= read -r name; do
    [ -z "$name" ] || printf '%s\n' "$1" | grep -Fqx -- "$name" || printf '%s\n' "$name"
  done
}
carried_by() { docker run --rm "$1" ls /app/install/supabase/migrations; }
# Older than the data: the database holds a migration the release does not carry, so a later release migrated it. That
# release's schema is not one the target was built for; going back takes a backup made before it. $1 names the release
# (release_ref), $2 holds the applied migrations.
refuse_older() {
  carried=$(carried_by "$release_ref") || fail "Could not read the migrations of $release_ref. Nothing was changed."
  missing=$(missing_from "$carried" "$2" | tr '\n' ' ')
  [ -z "$missing" ] || fail "gtmworks $1 is older than the data in $dir: a later release applied migrations that $1 does not carry (${missing% }). Nothing was changed. To go back to $1, restore a backup made with it: gtmworks restore <archive> --version $1"
}
# One machine runs one gtmworks install: every install's containers and volumes are named gtmworks-install, so an install
# in another folder would take over this one's. Read before anything changes.
check_project_owner() {
  owners=$(docker ps -a --filter label=com.docker.compose.project=gtmworks-install \
    --format '{{.Label "com.docker.compose.project.working_dir"}}') || fail "Could not list Docker's containers. Nothing was changed."
  here=$dir physical=$dir
  if [ -d "$dir" ]; then here=$(cd "$dir" && pwd -L) physical=$(cd "$dir" && pwd -P); fi
  other=$(printf '%s\n' "$owners" | while IFS= read -r owner; do
    [ -z "$owner" ] || [ "$owner" = "$here" ] || [ "$owner" = "$physical" ] || { printf '%s\n' "$owner"; break; }
  done)
  [ -z "$other" ] || fail "gtmworks already runs from $other on this machine, and one machine runs one gtmworks install (its containers and volumes are all named gtmworks-install). Use that install, or remove it there first. Nothing was changed."
  # Stopped containers can be gone (compose down) while the data stays in its volumes, whose keys are in the
  # .env.install of the folder that made them. A folder with an .env.install is that one when its mark names the volume's
  # creation time, or, with no mark (an install from before the mark), when no other folder is recorded as the maker.
  if created=$(data_created); then
    made_by=$(sed -n 1p "$owner_record" 2> /dev/null || true)
    mine=no
    if [ ! -f "$dir/.env.install" ]; then :
    elif [ -f "$dir/.gtmworks-data" ]; then [ "$(sed -n 1p "$dir/.gtmworks-data")" != "$created" ] || mine=yes
    elif [ -z "$made_by" ] || [ "$made_by" = "$dir" ]; then mine=yes; fi
    [ "$made_by" != "$dir" ] || made_by=
    [ "$mine" = yes ] || fail "Docker on this machine already holds gtmworks data (the volume gtmworks-install_database)${made_by:+, made by the install in $made_by}, and its keys are in that install's .env.install, not in $dir. Use that install${made_by:+: run the line again with --dir $made_by}. To start over without that data, back it up and remove its volumes first. Nothing was changed."
  fi
}

stage=
restore_marker=
cleanup() { status=$?; trap - EXIT; [ -z "$stage" ] || rm -rf "$stage"; [ -z "$restore_marker" ] || rm -f "$restore_marker"; exit "$status"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
new_stage() { stage=$(mktemp -d "$dir/.gtmworks-download.XXXXXX"); }

fetch() { curl -fsSL --retry 3 -o "$2" "$1" || fail "Could not download $1. Check this machine's internet access, then run this again."; }
tag_names() { printf '%s\n' "$1" | tr ',' '\n' | grep '"tag_name"[[:space:]]*:' || true; }
# The tag names of the releases GitHub does not mark as a prerelease: the rule of --exclude-pre-releases in the release
# workflow that moves stable and latest, so a vX.Y.Z release marked prerelease is never installed or updated to. A
# release's fields come over several lines, so its object is read whole; a body that names fields is still one string.
stable_tags() {
  printf '%s\n' "$1" | sed 's/[{}]/\n&\n/g' | awk '
    /"tag_name"[[:space:]]*:/ && tag == "" { tag = $0 }
    /"prerelease"[[:space:]]*:[[:space:]]*true/ { pre = 1 }
    /^\}[,]*$/ { if (tag != "" && !pre) print tag; tag = ""; pre = 0 }
  '
}
latest_release() {
  # GitHub lists 100 releases a page: every page is read, up to one with fewer.
  page=1 list=
  while :; do
    if [ -n "$releases" ]; then list_url=$releases/releases.json; else list_url="https://api.github.com/repos/$repository/releases?per_page=100&page=$page"; fi
    one=$(curl -fsSL --retry 3 "$list_url") || fail "Could not read the list of gtmworks releases ($list_url). Name one with --version vX.Y.Z, or try again later."
    list="$list
$one"
    [ -z "$releases" ] && [ "$(tag_names "$one" | wc -l)" -ge 100 ] || break
    page=$((page + 1))
  done
  latest=$(stable_tags "$list" \
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
  case "$1" in main@sha256:*)
    kept=$dir/.gtmworks-main/${1#main@sha256:}
    [ -f "$kept/install.sh" ] && [ -f "$kept/docker-compose.install.yml" ] \
      || fail "The files of the main build ${1#main@} are not kept in $dir, so it cannot be named. Nothing was changed."
    cp "$kept/install.sh" "$kept/docker-compose.install.yml" "$2/"
    check_assets "$2"
    [ "${release_ref##*@}" = "${1#main@}" ] || fail "The kept files in $kept are not those of ${1#main@}. Nothing was changed."
    return;;
  esac
  if [ "$1" = main ]; then
    say "Pulling the newest main build: $image:main"
    docker pull "$image:main"
    digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image:main" \
      | sed -n "s#^$image@\(sha256:[a-f0-9]\{64\}\)\$#\1#p" | head -n 1)
    [ -n "$digest" ] || fail "Could not read the digest of $image:main."
    ref=$image:main@$digest
    # The main image names the work sandbox image built from its own commit (#392, ADR 0020), by tag and digest, so its
    # install script pins that one and never a sandbox another main build pushed under the same tag.
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

# The gtmworks command of the build $1 ($release_ref), into $stage before anything changes (#437): the get.sh that build's
# image carries, so the command on the PATH matches the version installed. An image from before #437 carries none: the
# release's tag is read instead, or main for a main build.
stage_command() {
  from=
  if ! docker run --rm "$release_ref" cat /app/release-source/scripts/get.sh > "$stage/gtmworks.sh" 2> /dev/null; then
    case "$1" in v*) from=https://raw.githubusercontent.com/$repository/$1/scripts/get.sh;; *) from=$get_url;; esac
    fetch "$from" "$stage/gtmworks.sh"
  fi
  [ "$(sed -n 2p "$stage/gtmworks.sh")" = "$marker" ] || fail "The gtmworks command of gtmworks $1${from:+ ($from)} is not the gtmworks installer. Nothing was changed."
}
place_command() { cp "$stage/gtmworks.sh" gtmworks.sh.tmp; chmod 755 gtmworks.sh.tmp; mv gtmworks.sh.tmp gtmworks.sh; }

# The command on the PATH runs the copy of get.sh kept in the install folder, for that folder.
install_command() {
  place_command
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
  # zsh reads none of ~/.profile and the bash files: for a zsh user ~/.zshenv, read by every zsh, is made when missing.
  own=$HOME/.profile
  case "${SHELL:-}" in */zsh) own=${ZDOTDIR:-$HOME}/.zshenv;; esac
  for profile in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc" "$own"; do
    [ "$profile" = "$HOME/.profile" ] || [ "$profile" = "$own" ] || [ -f "$profile" ] || continue
    case "$added " in *" $profile "*) continue;; esac
    if [ -f "$profile" ] && grep -q '\.local/bin' "$profile"; then continue; fi
    printf '\n%s\n%s\n' '# Added by the gtmworks installer: the gtmworks command lives in ~/.local/bin.' "$path_line" >> "$profile"
    added="$added $profile"
  done
  if [ -n "$added" ]; then say "Added ~/.local/bin to the PATH in:$added. Open a new shell, or run: $path_line"
  else say "Your shell profile already puts ~/.local/bin on the PATH: open a new shell to use the gtmworks command."; fi
}

update_command() { if [ "$1" = main ] || [ "$1" = stable ]; then echo "gtmworks update --channel $1"; else echo "gtmworks update --version $1"; fi; }

op_install() {
  [ -n "${HOME:-}" ] || fail 'HOME is not set, so the gtmworks command has no ~/.local/bin to go in.'
  check_prerequisites
  need_curl
  lock_update
  check_project_owner
  current=$(pending) interrupted=yes
  [ -n "$current" ] || current=$(recorded) interrupted=no
  requested=$version
  [ "$channel" != main ] || requested=main
  [ "$channel" != stable ] || [ -n "$version" ] || requested=stable
  existing=no finished=no running=
  if [ -f "$dir/.env.install" ]; then
    existing=yes
    cd "$dir"
    test ! -e scripts/install.sh || fail "$dir is a source checkout: install from source with sh scripts/install.sh there, or choose another folder with --dir."
    running=$(cat .install-release 2> /dev/null || true)
    [ -z "$running" ] || [ "$(sed -n 's/^release_image=//p' install.sh 2> /dev/null)" != "$running" ] || finished=yes
    if [ -n "$current" ]; then
      case "$requested" in
        ''|"$current") ;;
        stable) [ "$current" != main ] || fail "$dir runs gtmworks main. To move it to the latest stable release, run: $(update_command stable). Nothing was changed.";;
        *) fail "$dir already runs gtmworks $current. To move it to $requested, run: $(update_command "$requested"). Nothing was changed.";;
      esac
      target=$current
      if [ "$interrupted" = yes ]; then say "Finishing the update of $dir to gtmworks $target, which did not finish; its keys and data are kept."
      else say "Repairing gtmworks $target in $dir; its keys and data are kept."; fi
    else
      # An install with data and no recorded release (a release installed by hand, or a first install that did not
      # finish): the release is chosen as for a new install, and checked against the data before anything changes.
      case "$requested" in ''|stable) target=$(latest_release);; *) target=$requested;; esac
      say "gtmworks in $dir has no recorded release; checking gtmworks $target against its data. Its keys and data are kept."
    fi
    applied=$(data_migrations) || fail "Could not read the migrations of the database in $dir: see gtmworks status. Nothing was changed."
  else
    # A first install the machine stopped in is finished with the target it began with, not one chosen again now (no
    # release list is read for it).
    if [ "$interrupted" = yes ]; then target=$current
    else
      target=${requested:-$(latest_release)}
      [ "$target" != stable ] || target=$(latest_release)
    fi
    say "Installing gtmworks $target into $dir."
    mkdir -p "$dir"
    cd "$dir"
    test ! -e scripts/install.sh || fail "$dir is a source checkout: install from source with sh scripts/install.sh there, or choose another folder with --dir."
  fi
  new_stage
  keep=no
  if [ "$interrupted" = yes ] && [ -f .gtmworks-pending.d/install.sh ] && [ -f .gtmworks-pending.d/docker-compose.install.yml ]; then
    # The update the machine stopped in is finished with the files it saved, not with what the install now holds.
    cp .gtmworks-pending.d/install.sh .gtmworks-pending.d/docker-compose.install.yml "$stage/"
    check_assets "$stage"
  elif [ "$target" = main ] && [ "$current" = main ] && [ -f install.sh ] && [ -f docker-compose.install.yml ]; then
    # A repair keeps the main build it runs; moving to a newer one is an update, which backs up first.
    keep=yes
    check_assets .
  else
    download_release "$target" "$stage"
  fi
  stage_command "$target"
  say "gtmworks $target: $release_ref"
  if [ "$existing" = yes ]; then
    if [ -z "$current" ] && [ "$finished" = yes ] && [ "$release_ref" != "$running" ]; then
      # A finished install moving to another release is an update: it backs up first and refuses older than the data.
      say "$dir runs $running: moving it to $target is an update."
      previous=
      update_to
      install_command
      install_updater
      own_data
      return
    fi
    refuse_older "$target" "$applied"
  fi
  [ "$keep" = yes ] || place_release "$stage"
  install_command
  install_updater
  data_created > /dev/null || claim_data
  # The target and its two files (now in place) are recorded before the installer runs, so an install that stops in the
  # middle is finished with the build it began with: a first install's version is recorded even when it stops after
  # migrations, and a main build by its digest.
  pin=$target
  [ "$target" != main ] || pin=main@${release_ref##*@}
  save_pending "$pin" .
  run_installer
  record_target "$target"
  own_data
}

op_update() {
  check_prerequisites
  need_curl
  in_install
  lock_update
  check_project_owner
  previous=$(recorded)
  running=$(cat .install-release 2> /dev/null || true)
  [ -n "$running" ] && [ "$(sed -n 's/^release_image=//p' install.sh)" = "$running" ] \
    || fail "The files in $dir are not those of the release it runs: an install or update did not finish. Repair it first with: gtmworks install. Nothing was changed."
  if [ -n "$version" ]; then target=$version
  elif [ "$channel" = main ] || { [ -z "$channel" ] && [ "$previous" = main ]; }; then target=main
  else target=$(latest_release); fi
  new_stage
  download_release "$target" "$stage"
  stage_command "$target"
  if [ "$release_ref" = "$running" ]; then
    record_target "$target"
    place_command
    say "gtmworks $target ($release_ref) already runs in $dir: nothing to update."
    return
  fi
  install_updater
  update_to
  own_data
}

# From a finished install of $running ($previous, when recorded) to $target, whose files are in $stage.
update_to() {
  say "Updating gtmworks ${previous:-(unrecorded)} to $target: $release_ref"
  docker pull "$release_ref"
  applied=$(database_migrations) || fail "Could not read the database's migrations: is gtmworks running? See gtmworks status. Nothing was changed."
  refuse_older "$target" "$applied"
  archive=
  if [ "$backup" = yes ]; then
    say 'Backing up before the update...'
    take_backup || fail 'The backup failed, so nothing was updated.'
    archive=$archive_made
    say "Backup: $archive"
  fi
  cp docker-compose.install.yml "$stage/previous-compose.yml"
  cp install.sh "$stage/previous-install.sh"
  # A main build is named by its digest to go back to it, so its two files are kept: main moves on.
  back=$previous
  case "$running" in "$image:main@sha256:"*)
    back=main@${running##*@}
    mkdir -p ".gtmworks-main/${running##*@sha256:}"
    cp install.sh docker-compose.install.yml ".gtmworks-main/${running##*@sha256:}/";;
  esac
  pin=$target
  [ "$target" != main ] || pin=main@${release_ref##*@}
  save_pending "$pin" "$stage"
  place_release "$stage"
  if run_installer update; then :; else
    status=$?
    say "The update to $target failed (exit $status)." >&2
    now=$(database_migrations) || now='(unreadable)'
    if [ "$now" = "$applied" ]; then
      # Its migrations rolled back, so the previous release's files go back with the schema it was serving on.
      cp "$stage/previous-compose.yml" docker-compose.install.yml
      cp "$stage/previous-install.sh" install.sh
      drop_pending
      if run_installer update > "$stage/return.log" 2>&1; then
        say "gtmworks ${previous:-(the previous release)} keeps serving, on its own files again." >&2
      else
        cat "$stage/return.log" >&2
        say "Putting the previous release's files back did not finish: run gtmworks install." >&2
      fi
    else
      # Its migrations may have run, so the data may now be $target's: the install is recorded as $target, and a repair
      # (gtmworks install) finishes $target rather than putting back a release older than the data.
      record_target "$target"
      say "Its migrations may have been applied before it failed, so this install stays on $target: run gtmworks install to finish it." >&2
    fi
    [ -z "$archive" ] || say "Backup: $archive" >&2
    exit "$status"
  fi
  record_target "$target"
  place_command
  now=$(database_migrations) || now=
  say "gtmworks $target is running: $release_ref"
  [ -z "$archive" ] || say "Backup: $archive"
  if [ -z "$previous" ]; then
    say "The release this install ran before is not recorded, so there is no command to go back to it."
  elif [ "$now" = "$applied" ]; then
    say "To go back to $back: $(update_command "$back")"
  elif [ -z "$archive" ]; then
    say "This update migrated the database and took no backup (--no-backup), so going back to $back needs a backup made before it."
  else
    say "To go back to $back: gtmworks restore $(quote "$archive") --version $back"
  fi
}

# The checks install.sh restore makes of an archive, made before anything changes: only the backup's own entries, none
# outside it, and each of them present. The Agents' data (opt/data, #349) is accepted when the archive holds it and not
# required: an archive the installer made before #349 restores, and install.sh says what it lacks.
check_archive() {
  entries=$(docker run --rm -i alpine:3.21 tar -tzf - < "$archive") || fail "$archive cannot be read as a gtmworks backup archive. Nothing was changed."
  # The target release's own installer makes the same check a restore makes, before anything changes (#378, T4): the
  # archive's entries, the Engines it holds and their keys are one check, not two that can drift. A release made before
  # this check keeps the copy below for archives it can restore.
  if grep -q 'check-restore' "$stage/install.sh"; then
    checked=$( ( cd "$stage" && sh ./install.sh check-restore "$archive" ) 2>&1 ) \
      || fail "$checked Nothing was changed."
    return 0
  fi
  bad=$(printf '%s\n' "$entries" | while IFS= read -r entry; do
    case "$entry" in /*|*../*|../*|*/..|..) printf 'an unsafe path: %s\n' "$entry"; break;; esac
    case "$entry" in .env.install|engines.list|var/lib/postgresql/data/*|etc/postgresql-custom/*|var/lib/storage/*|opt/data|opt/data/*|engines|engines/*|.engines|.engines/*) ;; *) printf 'an entry no backup holds: %s\n' "$entry"; break;; esac
  done)
  [ -z "$bad" ] || fail "$archive is not a gtmworks backup: it holds $bad. Nothing was changed."
  for entry in var/lib/postgresql/data/ etc/postgresql-custom/ var/lib/storage/ .env.install; do
    printf '%s\n' "$entries" | grep -Fqx -- "$entry" || fail "$archive is not a complete gtmworks backup: it has no $entry. Nothing was changed."
  done
  # Every Company's Engine is in the archive as one data folder per Engine under engines/, named as its folder under
  # .engines/ (its key), or, in an archive made before that (#386), as the first Engine's data at opt/data. An archive
  # naming an Engine without its data, data without its key, or both layouts at once cannot be fully restored.
  data_engines=$(printf '%s\n' "$entries" | sed -n 's#^engines/\([^/][^/]*\)/.*#\1#p' | sort -u)
  key_engines=$(printf '%s\n' "$entries" | sed -n 's#^\.engines/\([^/][^/]*\)/\.env$#\1#p' | sort -u)
  if printf '%s\n' "$entries" | grep -Eq '^engines/'; then
    printf '%s\n' "$entries" | grep -Eq '^opt/data(/|$)' \
      && fail "$archive is not a gtmworks backup: it holds one Engine's data at opt/data and every Engine's data under engines/. Nothing was changed."
    [ "$data_engines" = "$key_engines" ] \
      || fail "$archive is not a complete gtmworks backup: it does not hold every Company Engine. Nothing was changed."
    if [ -n "$data_engines" ]; then
      printf '%s\n' "$data_engines" | grep -qx first \
        || fail "$archive is not a complete gtmworks backup: it does not hold the first Engine. Nothing was changed."
    fi
  else
    other=$(printf '%s\n' "$key_engines" | grep -vx first | grep . || true)
    [ -z "$other" ] \
      || fail "$archive is not a complete gtmworks backup: it names an Engine without its data ($(printf '%s' "$other" | tr '\n' ' ')). Nothing was changed."
  fi
  # An Engine folder in the archive is named like an Engine and holds only its ENGINE_KEY (64 hex characters) (#378, X2).
  # install.sh writes each Engine's own file from that key with this release's standard names; a name or a line that
  # could point the install network or the database's volume at something else is refused before anything changes.
  for name in $key_engines; do
    printf '%s\n' "$name" | grep -Eq '^[a-z0-9-]+$' \
      || fail "$archive is not a gtmworks backup: it names an Engine folder that is not usable ($name). Nothing was changed."
    key=$(docker run --rm -i alpine:3.21 tar -xzOf - ".engines/$name/.env" < "$archive" 2> /dev/null | sed -n 's/^ENGINE_KEY=//p') \
      || fail "$archive is not a gtmworks backup: the Engine $name cannot be read. Nothing was changed."
    printf '%s\n' "$key" | grep -Eq '^[a-f0-9]{64}$' \
      || fail "$archive is not a gtmworks backup: the Engine $name has no usable key. Nothing was changed."
  done
}
# The archive's settings, checked as install.sh restore checks them (completed, then validated) but with the tool of the
# release that will run them, before anything stops: a restore that refused them later would leave an empty install.
check_archive_settings() {
  ( umask 077; docker run --rm -i alpine:3.21 tar -xzOf - .env.install < "$archive" > "$stage/archive.env" ) \
    || fail "Could not read the settings (.env.install) in $archive. Nothing was changed."
  ( umask 077; docker run --rm --env-file "$stage/archive.env" "$release_ref" node /app/install/lib/install-env.mjs missing > "$stage/archive.missing" ) \
    || fail "Could not check the settings in $archive with gtmworks $version. Nothing was changed."
  ( umask 077; { cat "$stage/archive.env"; if [ -n "$(tail -c 1 "$stage/archive.env")" ]; then echo; fi; cat "$stage/archive.missing"; } > "$stage/archive.complete" )
  docker run --rm --env-file "$stage/archive.complete" "$release_ref" node /app/install/lib/install-env.mjs validate complete \
    || fail "The settings in $archive (its .env.install) are not valid for gtmworks $version, for the reason above. Nothing was changed."
  rm -f "$stage/archive.env" "$stage/archive.missing" "$stage/archive.complete"
}
# The migrations the archive's database applied: its data folder, unpacked in a throwaway container of the database
# image the release runs, is read by Postgres in single-user mode (no server, no network, no settings of its own).
archive_migrations() {
  db_image=$(sed -n '/^  db:$/,/^  [^ ]/s/^    image: //p' "$stage/docker-compose.install.yml" | head -n 1)
  [ -n "$db_image" ] || fail "The compose file of gtmworks $version names no database image. Nothing was changed."
  read_out=$(docker run --rm -i --user postgres --entrypoint sh "$db_image" -ec '
    mkdir -p /tmp/check/var/lib/postgresql && cd /tmp/check
    tar -xzf - var/lib/postgresql/data
    chmod 700 var/lib/postgresql/data
    : > empty.conf
    printf "%s\n" "$1" | postgres --single -D /tmp/check/var/lib/postgresql/data -c config_file=/tmp/check/empty.conf -c shared_preload_libraries= postgres
  ' sh "select coalesce(string_agg(name, ' ' order by name), '') as migrations from gtmworks_install.schema_migrations;" < "$archive") \
    || fail "Could not read the migrations in $archive. Nothing was changed."
  printf '%s\n' "$read_out" | grep -q '1: migrations = "' || fail "Could not read the migrations in $archive. Nothing was changed."
  printf '%s\n' "$read_out" | sed -n 's/.*1: migrations = "\([^"]*\)".*/\1/p' | head -n 1 | tr ' ' '\n' | grep . || true
}
confirm() {
  [ "$yes" = no ] || return 0
  [ -t 0 ] || fail "$1 Run it again with --yes to go on. Nothing was changed."
  printf '%s Type yes to go on: ' "$1" >&2
  answer=
  read -r answer < /dev/tty || true
  [ "$answer" = yes ] || fail "Nothing was changed."
}

op_restore() {
  check_prerequisites
  case "$archive" in /*) ;; *)
    # backups/<name> also names the install folder's own backups, when this folder holds no such file.
    if [ ! -e "$archive" ] && [ -f "$dir/$archive" ]; then archive=$dir/$archive; else archive=$PWD/$archive; fi;;
  esac
  [ -f "$archive" ] || fail "There is no backup archive at $archive."
  in_install
  lock_update
  check_project_owner
  if [ -z "$version" ]; then run_installer restore "$archive"; return; fi
  # Going back to a release: the archive is checked, and the current data backed up, before this install is made anew
  # with that release's files, the archive restored into it, and that release's migrations applied. The agent engine's
  # volume is kept.
  #
  # The whole go-back holds .install-restore (#378, C5): `company add` takes install.sh's lock and refuses while the
  # marker is held, so a Company made between the safety backup below and the replacement is never lost without being in
  # that backup. A plain restore is one installer run under install.sh's own lock and needs no marker.
  restore_marker=$dir/.install-restore
  exec 8>>"$restore_marker"
  flock -n 8 || fail "Another gtmworks restore is running in $dir: wait for it to finish, then run this again. Nothing was changed."
  need_curl
  new_stage
  download_release "$version" "$stage"
  stage_command "$version"
  check_archive
  # A release from before #349 refuses an archive holding the Agents' data, but only once the volumes are gone: ask its
  # install.sh first.
  if printf '%s\n' "$entries" | grep -Eq '^opt/data(/|$)' && ! grep -Fq 'opt/data/*' "$stage/install.sh"; then
    fail "gtmworks $version cannot restore $archive: it holds the Agents' data, which releases before it cannot restore. Restore it with a newer release. Nothing was changed."
  fi
  # So does a release from before #385, whose restore knows no .engines/ (the Engines' keys).
  if printf '%s\n' "$entries" | grep -Eq '^\.engines(/|$)' && ! grep -Fq '.engines/*' "$stage/install.sh"; then
    fail "gtmworks $version cannot restore $archive: it holds the Engines' keys, which releases before it cannot restore. Restore it with a newer release. Nothing was changed."
  fi
  # And one from before #386, whose restore knows no engines/ (each Company's Engine data).
  if printf '%s\n' "$entries" | grep -Eq '^engines/' && ! grep -Fq 'engines|engines/*' "$stage/install.sh"; then
    fail "gtmworks $version cannot restore $archive: it holds each Company's Engine data, which releases before it cannot restore. Restore it with a newer release. Nothing was changed."
  fi
  check_archive_settings
  archived=$(archive_migrations)
  carried=$(carried_by "$release_ref") || fail "Could not read the migrations of $release_ref. Nothing was changed."
  missing=$(missing_from "$carried" "$archived" | tr '\n' ' ')
  [ -z "$missing" ] || fail "$archive holds migrations that gtmworks $version does not carry (${missing% }): a later release made it. Restore it with that release or a newer one. Nothing was changed."
  first=' The current data is backed up first.'
  [ "$backup" = yes ] || first=' The current data is not backed up first (--no-backup).'
  confirm "This replaces the data of the gtmworks install in $dir (its database, its files, and .env.install with its keys and settings) with the data in $archive, and runs gtmworks $version on it.$first The agent engine's data is kept."
  say "Going back to gtmworks $version with the data of $archive.$first"
  archive_made=
  if [ "$backup" = yes ]; then
    take_backup || fail 'The backup of the current data failed, so nothing was changed.'
    say "Backup of the current data: $archive_made"
  fi
  claim_data
  compose down
  docker volume rm gtmworks-install_database gtmworks-install_database-config gtmworks-install_files
  place_release "$stage"
  run_installer
  run_installer restore "$archive"
  # The archive may predate migrations $version carries: its update applies them, as an update to it would.
  run_installer update
  record_target "$version"
  place_command
  own_data
  say "gtmworks $version is running with the data of $archive.${archive_made:+ The data from before is in $archive_made.}"
}

op_backup() { check_prerequisites; in_install; check_project_owner; run_installer backup "${destination:-$dir/backups}"; }

# The Company commands are the installer's own (#382): get.sh keeps the gtmworks command's options, then hands the rest of
# the line to install.sh, which owns the Engine helpers and the Company scripts. install.sh's own lock serializes it with
# an install or update on this machine. The ownership check of `gtmworks backup` comes first, as it is a check only: one
# machine runs one install, so a command from another folder stops before it changes anything (#378, C5).
op_company() { check_prerequisites; in_install; check_project_owner; run_installer company "$@"; }

op_status() {
  check_prerequisites
  in_install
  say "gtmworks $(recorded | grep . || echo '(unrecorded version)') in $dir: $(cat .install-release 2> /dev/null || echo 'no finished install')"
  [ -z "$(pending)" ] || say "An update to gtmworks $(pending) did not finish: run gtmworks install to finish it."
  if row=$(updates read 2> /dev/null); then
    IFS='|' read -r button auto _ <<ROW
$row
ROW
    say "Update now button: $( [ "$button" = t ] && echo on || echo off). Automatic updates: $( [ "$auto" = t ] && echo on || echo off)."
  fi
  say "Updater: $(updater_kind | grep . || echo 'not installed (run gtmworks install)')"
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
    compose exec -T web node --input-type=module -e "for(const url of ['http://gateway:8080/api/health','http://gateway:8080/sign-in']) { const response=await fetch(url); console.log(url+' '+response.status); if(response.status!==200) process.exitCode=1; }" < /dev/null \
      || unhealthy=' the app'
    # Every Engine of the install with its Company's work sandbox (#382, #393): a stopped or unhealthy one is named, and
    # status fails.
    run_installer engines || unhealthy="$unhealthy an Engine or a work sandbox"
  fi
  [ -z "$unhealthy" ] || fail "Not healthy:$unhealthy. Repair with: gtmworks install"
  say "All $total services are healthy."
}

# #384, ADR 0018: Claude's sign-in is the Engine's own, run in the Company's Engine on its root profile, which lends it
# to every Agent of the Company. install.sh owns the Engine lookup and the container it runs in, as it does for `company`
# (#378, T4); stdin stays open because the sign-in asks for a pasted code. The ownership check comes first, as for every
# command that names a folder (#378, C5).
op_signin() {
  check_prerequisites
  in_install
  check_project_owner
  sh ./install.sh sign-in "$provider" --company "$company"
}

# Update now and automatic updates (#443, ADR 0020). The web app never controls Docker: an Owner's click only records a
# request in the database (public.install_updates), and the updater, this command run every minute by a systemd user
# timer or cron as the user who installed, reads it and runs `gtmworks update` exactly as a person would, under the same
# lock. The request names nothing: the update always goes to the newest version of the install's own channel. The row is
# read and written here as postgres inside the database container, by one fixed statement per step.
updates() {
  case "$1" in
    read) sql="select button, auto, state, coalesce(auto_checked_at < now() - interval '1 hour', true) from public.install_updates;";;
    button-on|button-off|auto-on|auto-off)
      column=${1%-*} value=false
      [ "${1#*-}" = off ] || value=true
      sql="insert into public.install_updates($column) values($value) on conflict (singleton) do update set $column=excluded.$column;";;
    ignore) sql="update public.install_updates set state='idle', changed_at=now() where state='requested';";;
    updating) sql="update public.install_updates set state='updating', changed_at=now(), auto_checked_at=now();";;
    checked) sql="update public.install_updates set auto_checked_at=now();";;
    updated|failed|current) sql="update public.install_updates set state='$1', version=nullif(:'version',''), changed_at=now(), auto_checked_at=now();";;
    *) echo "gtmworks knows no updater step $1." >&2; return 2;;
  esac
  # step names the statement in psql's own log (and to the tests' stand-in for the database); no statement reads it.
  printf '%s\n' "$sql" | compose exec -T db psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -v "step=$1" -v "version=${2:-}"
}
# The version running, as the updater reports it: a release's tag, or a main build by its digest.
running_version() {
  case "$(cat .install-release 2> /dev/null || true)" in
    "$image:main@sha256:"*) printf 'main@%s\n' "$(sed -n 's/.*@//p' .install-release)";;
    *) recorded;;
  esac
}
op_updater() {
  in_install
  mkdir -p "${update_lock%/*}" 2> /dev/null || return 0
  # One updater at a time; cron starts one every minute whether the last one finished or not.
  exec 7>"${update_lock%/*}/updater.lock"
  flock -n 7 || return 0
  # After the server starts again, each Company's work disk is mounted and its Engine and sandbox started (#507, ADR
  # 0032): they cannot start before. The installer does nothing for a Company that runs, and nothing while another
  # install step holds its lock; what it did is in the log beside the updater's.
  run_installer disks > "$dir/.gtmworks-disks.log" 2>&1 || true
  # No database, or one from before #443: nothing to read, nothing to do.
  row=$(updates read 2> /dev/null) || return 0
  IFS='|' read -r button auto state due <<ROW
$row
ROW
  # This updater holds its lock, so an update still marked running belongs to one the machine stopped.
  if [ "$state" = updating ]; then updates failed "$(running_version)" > /dev/null; return 0; fi
  if [ "$state" = requested ] && [ "$button" != t ]; then
    updates ignore > /dev/null
    say 'An update was asked for while the Update now button is off (gtmworks update-button off): ignored.'
    return 0
  fi
  if [ "$state" = requested ]; then why=request
  elif [ "$auto" = t ] && [ "$due" = t ]; then why=auto
  else return 0; fi
  # A person's own update or install holds the update lock: the request waits for the next run.
  flock -n "$update_lock" true || return 0
  before=$(cat .install-release 2> /dev/null || true)
  back=$(running_version)
  if [ "$why" = request ]; then updates updating > /dev/null; else updates checked > /dev/null; fi
  log=$dir/.gtmworks-updater.log
  # The update's output can hold the one-time setup link while first run is open: the log is the install user's alone.
  ( umask 077; : > "$log" )
  say "The updater runs gtmworks update ($why), from gtmworks ${back:-(unrecorded)}; its output is in $log."
  if sh "$dir/gtmworks.sh" --command --dir "$dir" update >> "$log" 2>&1; then
    if [ "$(cat .install-release 2> /dev/null || true)" = "$before" ]; then
      # A request that finds nothing newer is recorded as `current`, with the version still running, so the Owner is told
      # they are already on the newest instead of the offer coming back (#468).
      [ "$why" = auto ] || updates current "$back" > /dev/null
      say "gtmworks ${back:-(unrecorded)} is the newest of its channel: nothing to update."
    else
      updates updated "$(running_version)" > /dev/null
      say "Updated to gtmworks $(running_version)."
    fi
    return 0
  fi
  # The update records the release it runs only once it serves healthy. A new record means the new version came up and
  # something after it failed: it stays. No record means it started and did not come up, after its migrations may have
  # run, so the backup it took goes back with the version from before.
  after=$(cat .install-release 2> /dev/null || true)
  if [ -n "$after" ] && [ "$after" != "$before" ]; then
    updates updated "$(running_version)" > /dev/null || true
    say "gtmworks $(running_version) came up healthy, then the update stopped on a later step: see $log." >&2
    return 1
  fi
  if [ -z "$after" ]; then
    archive=$(sed -n 's/^Backup: //p' "$log" | tail -n 1)
    if [ -n "$archive" ] && [ -n "$back" ] \
      && sh "$dir/gtmworks.sh" --command --dir "$dir" restore "$archive" --version "$back" --yes --no-backup >> "$log" 2>&1; then
      say "The new version did not come up healthy: gtmworks $back is back, with the data from before the update."
    else
      say "The new version did not come up healthy, and putting gtmworks ${back:-(unrecorded)} back did not finish: run gtmworks install." >&2
    fi
  fi
  updates failed "$(running_version)" > /dev/null || true
  say "The update failed; gtmworks $(running_version | grep . || echo '(unrecorded)') runs. See $log." >&2
  return 1
}
op_switch() {
  check_prerequisites
  in_install
  check_project_owner
  case "$operation" in update-button) step=button-$setting;; *) step=auto-$setting;; esac
  updates "$step" > /dev/null \
    || fail "Could not change it: the database of $dir is not running (see gtmworks status), or comes from before Update now (gtmworks update brings it). Nothing was changed."
  case "$step" in
    button-on) say 'Update now is on: Owners see the button when a newer gtmworks is out, and the updater installs it when one of them asks.';;
    button-off) say 'Update now is off: Owners see no button, and the updater ignores any request. Update with: gtmworks update';;
    auto-on) say "Automatic updates are on: the updater installs each newer gtmworks of this install's channel by itself, backing up first.";;
    auto-off) say 'Automatic updates are off: a newer gtmworks waits for an Owner to click Update now, or for gtmworks update.';;
  esac
  [ -n "$(updater_kind)" ] || say 'The updater is not installed on this machine yet: run gtmworks install.'
}
# How the updater runs here: a systemd user timer, cron, or nothing yet.
updater_kind() {
  if systemctl --user is-enabled gtmworks-updater.timer > /dev/null 2>&1; then echo 'a systemd user timer, every minute'
  elif crontab -l 2> /dev/null | grep -qF '# gtmworks updater'; then echo 'cron, every minute'; fi
}
# The updater's timer, as the user who installs: a systemd user timer, or cron where systemd user units are missing. It
# runs the gtmworks command with the PATH and DOCKER_HOST of this run, so it reaches the same Docker. Written again by
# every install and update, removed by nothing.
install_updater() {
  command=$HOME/.local/bin/gtmworks
  # Each value whole, one per line: a PATH may hold spaces (WSL's /mnt/c/Program Files) or `%`, which cron reads as a
  # newline and systemd as a specifier.
  environment=$(printf 'PATH=%s\n' "$PATH"; [ -z "${DOCKER_HOST:-}" ] || printf 'DOCKER_HOST=%s\n' "$DOCKER_HOST")
  if systemctl --user show-environment > /dev/null 2>&1; then
    units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
    mkdir -p "$units"
    {
      printf '%s\n' '[Unit]' 'Description=gtmworks updater: Update now and automatic updates' '' '[Service]' 'Type=oneshot'
      printf '%s\n' "$environment" | sed 's/%/%%/g; s/["\\]/\\&/g; s/.*/Environment="&"/'
      printf 'ExecStart="%s" updater\n' "$command"
    } > "$units/gtmworks-updater.service"
    printf '%s\n' '[Unit]' 'Description=Run the gtmworks updater every minute' '' '[Timer]' 'OnBootSec=1min' 'OnUnitActiveSec=1min' '' \
      '[Install]' 'WantedBy=timers.target' > "$units/gtmworks-updater.timer"
    if ! { systemctl --user daemon-reload && systemctl --user enable --now gtmworks-updater.timer; } > /dev/null 2>&1; then
      say "Could not start the gtmworks updater's systemd timer, so Update now and automatic updates wait for it: run gtmworks install again. gtmworks update still works."
      return 0
    fi
    # A user's timers run only while they are signed in, unless systemd keeps their services running (linger).
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2> /dev/null)" != yes ] && ! loginctl enable-linger > /dev/null 2>&1; then
      say "The gtmworks updater runs while $(id -un) is signed in to this server. To keep it running always: sudo loginctl enable-linger $(id -un)"
    fi
    say 'The gtmworks updater runs every minute (a systemd user timer): Update now, and automatic updates (gtmworks auto-update on).'
  elif command -v crontab > /dev/null 2>&1; then
    # env runs the command with each quoted NAME=value: a quoted assignment alone would be read as the command's name.
    entry="* * * * * env $(printf '%s\n' "$environment" | while IFS= read -r pair; do printf '%s ' "$(quote "$pair")"; done | sed 's/%/\\%/g')$(quote "$command") updater > /dev/null 2>&1 # gtmworks updater"
    # The table is read whole before it is written back: the other lines in it stay as they were.
    table=$(crontab -l 2> /dev/null | grep -vF '# gtmworks updater' || true)
    if ! { [ -z "$table" ] || printf '%s\n' "$table"; printf '%s\n' "$entry"; } | crontab - > /dev/null 2>&1; then
      say "Could not add the gtmworks updater to cron, so Update now and automatic updates wait for it: run gtmworks install again. gtmworks update still works."
      return 0
    fi
    say 'The gtmworks updater runs every minute (cron): Update now, and automatic updates (gtmworks auto-update on).'
  else
    say 'This machine has no systemd user timers and no cron, so the gtmworks updater is not installed: Update now and automatic updates need it. gtmworks update still works.'
  fi
}

case "$operation" in
  sign-in) op_signin;;
  update-button|auto-update) op_switch;;
  company) "op_company" "$@";;
  *) "op_$operation";;
esac
}
main "$@"
