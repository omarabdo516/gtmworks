#!/usr/bin/env bash
# The install lane's Docker machine (`./ci.sh install`, #388, #416): one `gtmworks-install-lane` container on this host's
# Docker, with its throwaway checkout and work folder, and its removal however the run ends.
#
#   start WORK PORT   removes a machine an earlier run left behind, then starts this run's, labelled with WORK
#   remove WORK       removes this run's machine, its checkout and WORK; run by the lane's EXIT trap
#   guard PID WORK    detaches from the lane and runs `remove WORK` once PID has ended: the cleanup of a run killed
#                     with no chance to run its trap (SIGKILL, or a tool killing the whole process tree)
#
# Every command here talks to this host's Docker: the lane points DOCKER_HOST at the machine only for the commands meant
# for it, never in its own shell, so a trap run at the end cannot ask the machine to remove itself (#416). The removal
# finds the machine by this run's label, not its name, so a late guard never removes the machine of a run started after.
set -uo pipefail
name=gtmworks-install-lane
here=$(cd "$(dirname "$0")/.." && pwd)
label() { printf 'gtmworks.install-lane=%s' "$1"; }

case "${1:-}" in
 start)
  work=$2 port=$3
  # One install lane at a time on this machine: a machine an interrupted run left behind is removed first.
  docker rm -fv "$name" > /dev/null 2>&1 || true
  docker run -d --privileged --name "$name" --label "$(label "$work")" -e DOCKER_TLS_CERTDIR= -p "127.0.0.1:$port:2375" \
    -v "$work/src:$work/src" docker:28.5.1-dind > /dev/null
  ;;
 remove)
  work=$2
  # A signal can end the lane while `docker run` is still starting the machine (#416): wait for that command to finish,
  # so the machine it makes is there to be removed, then remove whatever carries this run's label.
  # pgrep reads a pattern, so the work path's own characters are escaped.
  starting=$(printf -- '--label %s' "$(label "$work")" | sed 's/[][\.*^$+?(){}|]/\\&/g')
  if command -v pgrep > /dev/null; then
    for _ in $(seq 1 60); do pgrep -f -- "$starting" > /dev/null || break; sleep 0.5; done
  fi
  ids=$(docker ps -aq --filter "label=$(label "$work")" 2> /dev/null || true)
  [[ -z $ids ]] || docker rm -fv $ids > /dev/null 2>&1 || true
  git -C "$here" worktree remove --force "$work/src" > /dev/null 2>&1 || true
  rm -rf "$work" 2> /dev/null || true
  # On rootful Docker the proof's containers leave files of root's in the checkout, which this user cannot remove: a
  # container of the machine's image, already on this host, removes them.
  if [[ -e $work ]]; then
    docker run --rm --entrypoint rm -v "$work:$work" docker:28.5.1-dind -rf "$work" > /dev/null 2>&1 || true
    rm -rf "$work" 2> /dev/null || true
  fi
  git -C "$here" worktree prune > /dev/null 2>&1 || true
  ;;
 guard)
  pid=$2 work=$3
  # Out of the lane's session and process tree, so whatever kills the lane does not reach the guard. It also ends once
  # the work folder is gone, which the trap's removal does last, so a lane PID taken by another process keeps no guard.
  watch="while kill -0 $pid 2> /dev/null && [ -d $(printf %q "$work") ]; do sleep 1; done; exec bash $(printf %q "$0") remove $(printf %q "$work")"
  if command -v setsid > /dev/null; then setsid -f bash -c "$watch" < /dev/null > /dev/null 2>&1
  else perl -MPOSIX -e 'fork and exit; POSIX::setsid() or die "setsid: $!"; exec @ARGV' bash -c "$watch" < /dev/null > /dev/null 2>&1
  fi
  ;;
 *) echo 'usage: scripts/install-lane-machine.sh start WORK PORT | remove WORK | guard PID WORK' >&2; exit 2;;
esac
