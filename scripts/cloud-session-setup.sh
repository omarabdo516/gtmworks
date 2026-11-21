#!/usr/bin/env bash
# The machine a Claude Code cloud session builds on (#485). `.claude/settings.json` runs this at every session start
# (https://code.claude.com/docs/en/cloud-environments, "Install dependencies with a SessionStart hook"): outside a cloud
# session (CLAUDE_CODE_REMOTE is not true) it exits at once; inside one it starts dockerd in the background, so the
# local Supabase stack can start later, and installs the dependencies when the lockfile changed since the last install.
# `npm run cloud:up` (scripts/cloud-up.sh) runs the same steps by name on any machine:
#   deps     install the dependencies when package-lock.json changed or node_modules is missing
#   docker   start dockerd if no daemon answers, and wait until one does; a pid file left from before the machine
#            restarted is removed first (#522)
#   browser  install the Chromium this checkout's Playwright pins when it is not on the machine yet
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=node_modules/.gtmworks-lock-hash
log_dir=${TMPDIR:-/tmp}
docker_run_dir=${GTMWORKS_DOCKER_RUN_DIR:-/var/run}

deps() {
 local hash
 hash=$(sha256sum package-lock.json | cut -d' ' -f1)
 if [[ -d node_modules && -f $stamp && $(cat "$stamp") == "$hash" ]]; then return 0; fi
 echo 'Installing dependencies (package-lock.json changed)…'
 npm ci --no-audit --no-fund > "$log_dir/gtmworks-npm-ci.log" 2>&1 || { tail -20 "$log_dir/gtmworks-npm-ci.log" >&2; return 1; }
 mkdir -p node_modules
 echo "$hash" > "$stamp"
}

# A restored VM keeps the pid files of the daemons that ran before it stopped, and by now their pid can be another
# process (the session's worker): dockerd, and the containerd it manages, take any live pid as theirs still running and
# never start (#522). Removes each pid file whose pid is not a running containerd or dockerd, with containerd's sockets.
clear_stale_pid_files() {
 local file pid name
 for file in "$docker_run_dir/docker/containerd/containerd.pid" "$docker_run_dir/docker.pid"; do
  # Read and removed with the same rights dockerd will run with (the sudo prefix in "$@", if any).
  pid=$("$@" cat "$file" 2> /dev/null | tr -dc 0-9) || continue
  [[ -n $pid ]] && name=$(ps -o comm= -p "$pid" 2> /dev/null) || name=''
  [[ $name == containerd || $name == dockerd ]] && continue
  echo "Removing the stale $file (pid ${pid:-none} is ${name:-not running})"
  if [[ $file == */containerd.pid ]]; then
   "$@" bash -c 'rm -f "$1"/containerd.pid "$1"/containerd.sock* "$1"/containerd-debug.sock' _ "${file%/*}"
  else
   "$@" rm -f "$file"
  fi
 done
}

# Starts dockerd detached when no daemon answers and none is running. With `wait`, waits up to 90 seconds for it.
# One start at a time (the hook's and `cloud:up`'s can overlap): the lock covers the check, the stale files and the
# launch, until the new dockerd shows in the process list, so no start removes the files of a daemon another just began.
docker_up() {
 docker info > /dev/null 2>&1 && return 0
 exec 9> "$log_dir/gtmworks-docker-up.lock"
 flock -w 30 9 || { echo 'another Docker start held its lock for 30 seconds' >&2; return 1; }
 if ! pgrep -x dockerd > /dev/null 2>&1; then
  command -v dockerd > /dev/null 2>&1 || { exec 9>&-; echo 'no Docker daemon answers and dockerd is not installed' >&2; return 1; }
  local sudo=()
  if [[ $(id -u) != 0 ]] && command -v sudo > /dev/null 2>&1; then sudo=(sudo -n); fi
  clear_stale_pid_files "${sudo[@]}"
  # The daemon must not inherit the lock, or it would hold it as long as it runs.
  setsid nohup "${sudo[@]}" dockerd > "$log_dir/gtmworks-dockerd.log" 2>&1 < /dev/null 9>&- &
  for _ in $(seq 1 50); do pgrep -x dockerd > /dev/null 2>&1 && break; sleep 0.1; done
 fi
 exec 9>&-
 [[ ${1:-} == wait ]] || return 0
 for _ in $(seq 1 90); do docker info > /dev/null 2>&1 && return 0; sleep 1; done
 echo "the Docker daemon did not answer within 90 seconds (log: $log_dir/gtmworks-dockerd.log)" >&2
 return 1
}

# Cloud images carry a Chromium for their own Playwright; a checkout pinning another release needs its own build.
browser() {
 node -e 'process.exit(require("fs").existsSync(require("playwright").chromium.executablePath())?0:1)' 2> /dev/null && return 0
 echo "Installing the Chromium this checkout's Playwright uses…"
 npx --no-install playwright install chromium > "$log_dir/gtmworks-playwright-install.log" 2>&1 || { tail -20 "$log_dir/gtmworks-playwright-install.log" >&2; return 1; }
}

case ${1:-hook} in
 hook)
  [[ ${CLAUDE_CODE_REMOTE:-} == true ]] || exit 0
  docker_up
  deps
  echo 'Cloud session ready: run `npm run cloud:up` to start the local app (docs/agents/cloud-verify.md).'
  ;;
 deps) deps ;;
 docker) docker_up wait ;;
 browser) browser ;;
 *) echo 'usage: scripts/cloud-session-setup.sh [hook|deps|docker|browser]' >&2; exit 2 ;;
esac
