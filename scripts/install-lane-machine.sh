#!/usr/bin/env bash
# The install lane's Docker machine (`./ci.sh install`, #388, #416): one `gtmworks-install-lane` container on this host's
# Docker, with its throwaway checkout and work folder, and its removal however the run ends.
#
#   start WORK PORT       removes a machine an earlier run left behind, then starts this run's, labelled with WORK
#   remove WORK LANE_PID  the lane's EXIT trap: stops the lane's own commands, then removes this run's machine, its
#                         checkout and WORK
#   guard LANE_PID WORK   detaches from the lane and, once LANE_PID has ended, finishes what the trap could not: the
#                         cleanup of a run killed with no chance to run its trap (SIGKILL, or a tool killing the whole
#                         process tree), a machine still starting, or a host Docker that refused the trap's removal
#
# Every command here talks to this host's Docker: the lane points DOCKER_HOST at the machine only for the commands meant
# for it, never in its own shell, so a trap run at the end cannot ask the machine to remove itself (#416). The machine is
# found by this run's label, not its name, so a late guard never removes the machine of a run started after. WORK is
# removed only once Docker has listed no machine of this run: while it is there, the guard keeps trying.
set -uo pipefail
name=gtmworks-install-lane
here=$(cd "$(dirname "$0")/.." && pwd)
label() { printf 'gtmworks.install-lane=%s' "$1"; }

# Waits while a `docker run` is still starting this run's machine: up to $1 seconds, or as long as it takes with 0.
# pgrep reads a pattern, so the work path's own characters are escaped.
start_done() {
  local limit=$1 waited=0 starting
  command -v pgrep > /dev/null || return 0
  starting=$(printf -- '--label %s' "$(label "$work")" | sed 's/[][\.*^$+?(){}|]/\\&/g')
  while pgrep -f -- "$starting" > /dev/null; do
    if (( limit && waited >= limit )); then return 1; fi
    sleep 1; waited=$((waited + 1))
  done
}

# Every process under $1 but this script, so the proof's areas, in subshells of their own, stop with the lane.
tree() {
  local child
  for child in $(pgrep -P "$1" 2> /dev/null); do
    [[ $child == "$$" ]] && continue
    echo "$child"; tree "$child"
  done
}
running() { local p; for p in "$@"; do [[ $(ps -o stat= -p "$p" 2> /dev/null) =~ ^[^Z] ]] && return 0; done; return 1; }
stop_tree() {
  local pids
  pids=$(tree "$1")
  [[ -n $pids ]] || return 0
  kill -TERM $pids 2> /dev/null
  for _ in $(seq 1 20); do running $pids || return 0; sleep 0.25; done
  kill -KILL $pids 2> /dev/null
}

# True only once Docker has listed no machine of this run: a listing Docker refuses is not an empty one.
machine_gone() {
  local ids
  ids=$(docker ps -aq --filter "label=$(label "$work")" 2> /dev/null) || return 1
  [[ -z $ids ]] && return 0
  docker rm -fv $ids > /dev/null 2>&1
  ids=$(docker ps -aq --filter "label=$(label "$work")" 2> /dev/null) || return 1
  [[ -z $ids ]]
}

remove_files() {
  git -C "$here" worktree remove --force "$work/src" > /dev/null 2>&1 || true
  rm -rf "$work" 2> /dev/null || true
  # On rootful Docker the proof's containers leave files of root's in the checkout, which this user cannot remove: a
  # container of the machine's image, already on this host, removes them.
  if [[ -e $work ]]; then
    docker run --rm --entrypoint rm -v "$work:$work" docker:28.5.1-dind -rf "$work" > /dev/null 2>&1 || true
    rm -rf "$work" 2> /dev/null || true
  fi
  git -C "$here" worktree prune > /dev/null 2>&1 || true
}

case "${1:-}" in
 start)
  work=$2 port=$3
  # One install lane at a time on this machine: a machine an interrupted run left behind is removed first.
  docker rm -fv "$name" > /dev/null 2>&1 || true
  docker run -d --privileged --name "$name" --label "$(label "$work")" -e DOCKER_TLS_CERTDIR= -p "127.0.0.1:$port:2375" \
    -v "$work/src:$work/src" docker:28.5.1-dind > /dev/null
  ;;
 remove)
  work=$2 lane=$3
  # A signal can end the lane while `docker run` is still starting the machine: the trap waits a while for it, and a
  # machine still starting after that, or one Docker would not remove, is left with WORK to the guard.
  if start_done "${INSTALL_LANE_START_WAIT:-60}"; then
    stop_tree "$lane"
    for _ in 1 2 3; do machine_gone && { remove_files; exit 0; }; sleep 1; done
  fi
  echo "the install lane's Docker machine is not removed yet: a guard goes on removing it once this run has ended" >&2
  ;;
 sweep)
  # The guard's part, once the lane has ended: nothing to do when the trap removed WORK; otherwise wait for a machine
  # still starting, then try every few seconds until Docker lists none, for at most an hour (a later run's start
  # removes a leftover machine too).
  work=$2
  [[ -d $work ]] || exit 0
  start_done 3600
  for _ in $(seq 1 720); do machine_gone && { remove_files; exit 0; }; sleep 5; done
  ;;
 guard)
  pid=$2 work=$3
  # Out of the lane's session and process tree, so whatever kills the lane does not reach the guard. It also ends once
  # the work folder is gone, which the trap's removal does last, so a lane PID taken by another process keeps no guard.
  watch="while kill -0 $pid 2> /dev/null && [ -d $(printf %q "$work") ]; do sleep 1; done; exec bash $(printf %q "$0") sweep $(printf %q "$work")"
  if command -v setsid > /dev/null; then setsid -f bash -c "$watch" < /dev/null > /dev/null 2>&1
  else perl -MPOSIX -e 'fork and exit; POSIX::setsid() or die "setsid: $!"; exec @ARGV' bash -c "$watch" < /dev/null > /dev/null 2>&1
  fi
  ;;
 *) echo 'usage: scripts/install-lane-machine.sh start WORK PORT | remove WORK LANE_PID | sweep WORK | guard LANE_PID WORK' >&2; exit 2;;
esac
