#!/usr/bin/env bash
# Probe C of spec #822, its install part (#829): does the plugin, and what it was told, come back from the install's own
# backup and restore? On the install proof's own stack: a source install made by the proof's helpers
# (scripts/ci-install-lib.sh) in a throwaway checkout of HEAD, on this machine's Docker. It places the plugin in the main
# Agent's profile of the first Company's Engine, marks a session as an Owner's, runs `sh scripts/install.sh backup`,
# empties the install, installs again and runs `sh scripts/install.sh restore <archive>`, then reads the plugin, the
# mark and the plugin's toolset back over the Engine's HTTP routes. Everything it made is removed at the end.
#
#   bash docs/engine-probes/plugin-tool/install-backup.sh     (commit first: it runs HEAD; about 20 minutes)
#
# It needs the port a source install takes on 127.0.0.1 (3000) free, so stop `npm run cloud:up` first.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
work=$(mktemp -d "$(git -C "$repo" rev-parse --absolute-git-dir)/probe-install.XXXXXX")
git -C "$repo" worktree add -q --detach "$work/src" HEAD
cp -al "$(readlink -f "$repo/node_modules")" "$work/src/node_modules"
cd "$work/src"
# shellcheck source=../../../scripts/ci-install-lib.sh
. scripts/ci-install-lib.sh
fail_prefix='probe failed: '
# remove_install leaves each Engine's screen-driver container (scripts/engine-template.yml), which holds the Engine's
# data volume, so that volume outlives the removal; both go here, so the install the archive goes into is empty.
gone_with_install() {
  docker ps -aq --filter 'name=^gtmworks-screen-driver-' | xargs -r docker rm -f > /dev/null
  docker volume ls -q --filter 'name=^gtmworks-' | xargs -r docker volume rm > /dev/null
}
done_with() {
  status=$?
  if [ -f .env.install ]; then remove_install > /dev/null 2>&1 || true; fi
  gone_with_install > /dev/null 2>&1 || true
  cd "$repo"
  git worktree remove --force "$work/src" > /dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap done_with EXIT
say() { echo "$@"; }

PLUGIN=gtmworks-people
# As ./ci.sh install does: the app and work sandbox images are built on this machine through scripts/docker-build.sh,
# from this checkout, and the installer is told they are there.
for pair in "$(web_image_tag) ." "$(sed -n 's/^ *image: ${SANDBOX_IMAGE:-\(.*\)}$/\1/p' scripts/engine-template.yml | head -n 1) sandbox"; do
  set -- $pair
  bash scripts/docker-build.sh -q -t "$1" "$2" > /dev/null || fail "build $1"
done
export GTMWORKS_IMAGE_PREBUILT=true
reset_install
install_source "$work/install.log" > /dev/null || { tail -40 "$work/install.log" >&2; fail 'the source install'; }
complete_setup > "$work/setup.log" 2>&1 || { cat "$work/setup.log" >&2; fail 'first run'; }
say "install: $(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1) as the first Company's Engine"

# The first Company's main Agent and its own Engine, read from the install's own records.
for attempt in $(seq 1 240); do
  profile=$(db -c "select a.profile from public.hermes_agents a where a.is_default limit 1")
  [ -n "$profile" ] && break
  [ "$attempt" = 240 ] && fail 'the first Company gets its main Agent'
  sleep 1
done
engine=$(first_engine_id)
key=$(first_engine_key)
manage() {
  local address
  address=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$(first_engine_id)")
  curl -s -m 20 -H "Authorization: Bearer $key" -H 'Content-Type: application/json' "$@" | sed "s#http://$address:9119##g"
}
at() { local address; address=$(docker inspect -f '{{(index .NetworkSettings.Networks "gtmworks-engine-first").IPAddress}}' "$(first_engine_id)"); printf 'http://%s:%s' "$address" "$1"; }
say "main Agent's profile: $profile"

# The plugin in the profile's own folder of the Engine's data volume, enabled there, the Engine restarted once.
docker exec -u hermes "$engine" mkdir -p "/opt/data/profiles/$profile/plugins"
docker cp "$here/plugin" "$engine:/opt/data/profiles/$profile/plugins/$PLUGIN"
docker exec -u 0 "$engine" chown -R hermes:hermes "/opt/data/profiles/$profile/plugins/$PLUGIN"
manage -X PUT -d "{\"config\":{\"plugins\":{\"enabled\":[\"$PLUGIN\"]}}}" "$(at 9119)/api/config?profile=$profile" > /dev/null
docker restart "$engine" > /dev/null
engine_healthy "$(first_engine_id)" 120 || fail 'the Engine is healthy after the plugin was placed'
marked=$(manage -d '{"session_id":"conversation-owner","person":"owner-1"}' "$(at 9119)/api/plugins/$PLUGIN/owner-sessions?profile=$profile")
say "mark a session through the plugin's route: $marked"
toolset() { manage "$(at 8642)/p/$profile/v1/toolsets" | python3 -c 'import json,sys; d=json.load(sys.stdin); print([ (t["name"], t["enabled"]) for t in (d.get("toolsets") or d.get("data") or []) if t["name"]=="gtmworks"])'; }
say "before the backup: the plugin's toolset $(toolset); its marks $(manage "$(at 9119)/api/plugins/$PLUGIN/owner-sessions?profile=$profile")"

# The install's own backup.
sh scripts/install.sh backup > "$work/backup.log" 2>&1 || { cat "$work/backup.log" >&2; fail 'sh scripts/install.sh backup'; }
archive=$(find backups -name '*.tgz' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
tar -tzf "$archive" > "$work/archive.list"
say "backup: $(grep -c . "$work/archive.list") entries; the plugin's entries:"
grep -E "^engines/[^/]+/profiles/$profile/(plugins/$PLUGIN/[^/]*$|plugin-data/$PLUGIN/)" "$work/archive.list" | sed 's/^/  /'
grep -q "^engines/first/profiles/$profile/plugins/$PLUGIN/__init__.py$" "$work/archive.list" || fail 'the backup holds the plugin'
grep -q "^engines/first/profiles/$profile/plugin-data/$PLUGIN/data.db$" "$work/archive.list" || fail 'the backup holds what the plugin was told'

# Emptied, installed again and restored by the install's own commands, as the proof's backup areas do.
remove_install > /dev/null 2>&1 || fail 'remove the install'
say "left after remove_install: $(docker ps -a --format '{{.Names}}' | grep '^gtmworks-' | tr '\n' ' ')$(docker volume ls -q | grep '^gtmworks-' | tr '\n' ' ')"
gone_with_install
rm -f .env.install
install_source "$work/reinstall.log" > /dev/null || { tail -40 "$work/reinstall.log" >&2; fail 'the fresh install before the restore'; }
fresh=$(docker exec "$(first_engine_id)" sh -c "test -d /opt/data/profiles/$profile && echo present || echo absent")
say "a fresh, empty install: the main Agent's profile folder $fresh"
[ "$fresh" = absent ] || fail 'the install the archive goes into is empty'
sh scripts/install.sh restore "$archive" > "$work/restore.log" 2>&1 || { cat "$work/restore.log" >&2; fail 'sh scripts/install.sh restore'; }
engine_healthy "$(first_engine_id)" 180 || fail 'the restored Engine is healthy'
key=$(first_engine_key)
say "after the restore: the plugin's files $(docker exec "$(first_engine_id)" ls "/opt/data/profiles/$profile/plugins/$PLUGIN" | tr '\n' ' ')"
say "after the restore: the plugin's toolset $(toolset); its marks $(manage "$(at 9119)/api/plugins/$PLUGIN/owner-sessions?profile=$profile")"
manage "$(at 9119)/api/plugins/$PLUGIN/owner-sessions?profile=$profile" | grep -q '"session_id":"conversation-owner"' || fail 'the restore brings back what the plugin was told'
toolset | grep -q "('gtmworks', True)" || fail 'the restored Engine offers the toolset of the plugin'
say 'probe complete'
