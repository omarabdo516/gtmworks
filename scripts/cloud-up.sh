#!/usr/bin/env bash
# One command brings the whole local app up (#485; docs/agents/cloud-verify.md): `npm run cloud:up` starts Docker when no
# daemon answers, installs the dependencies when the lockfile changed (scripts/cloud-session-setup.sh), rebuilds the local
# Supabase stack with its seed (scripts/local-db.sh), starts the fake Engine (scripts/cloud-hermes.mjs) and the app with
# its worker (scripts/web.sh) in the background, waits until the app answers, signs the seeded Owner in with a browser
# (scripts/cloud-verify.mjs --sign-in) and prints where everything is. Every credential is the local stack's own.
#   npm run cloud:up -- --fresh   the same, then empties the install, so the printed setup link walks first run
#   npm run cloud:down            stops the app, the fake Engine and the local stack (its volumes stay)
# Running it again stops what the last run started and starts from a freshly seeded database.
set -euo pipefail
cd "$(dirname "$0")/.."
usage() { echo 'usage: npm run cloud:up [-- --fresh] | npm run cloud:down' >&2; exit 2; }
mode=up
[[ $# -le 1 ]] || usage
case ${1:-} in '') ;; --fresh) mode=fresh ;; --down) mode=down ;; *) usage ;; esac

# Outside the checkout: `next dev` watches every file in it, and a log written there recompiles the app without end.
state=${TMPDIR:-/tmp}/gtmworks-cloud
origin=http://127.0.0.1:3000
seeded_email=omar@example.com seeded_password=local-seed-password

# Stops the processes the last run started: each was started as the leader of its own process group, so the group goes.
stop_own() {
 local name pid
 for name in web hermes; do
  [[ -f $state/$name.pid ]] || continue
  pid=$(cat "$state/$name.pid")
  if kill -0 "$pid" 2> /dev/null; then
   kill -TERM -- "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null || true
   for _ in $(seq 1 20); do kill -0 "$pid" 2> /dev/null || break; sleep 0.5; done
   kill -KILL -- "-$pid" 2> /dev/null || true
  fi
  rm -f "$state/$name.pid"
 done
}
taken() { (exec 3<> "/dev/tcp/$1") 2> /dev/null; }

if [[ $mode == down ]]; then
 stop_own
 npx --no-install supabase stop --project-id repo > /dev/null 2>&1 || true
 echo 'Stopped the local app, the fake Engine and the local Supabase stack.'
 exit 0
fi

bash scripts/cloud-session-setup.sh docker
bash scripts/cloud-session-setup.sh deps
stop_own
# The app's port, and the fake Engine's where scripts/web.sh points lane 0's app (tests/lane.mjs hermesHostOf).
for address in 127.0.0.1/3000 127.0.0.110/8642; do
 if taken "$address"; then echo "${address/\//:} is taken by a process cloud:up did not start; stop it, then run npm run cloud:up again" >&2; exit 1; fi
done

echo 'Starting the local Supabase stack (scripts/local-db.sh)…'
bash scripts/local-db.sh > "${TMPDIR:-/tmp}/gtmworks-local-db.log" 2>&1 || { tail -30 "${TMPDIR:-/tmp}/gtmworks-local-db.log" >&2; exit 1; }
mkdir -p "$state"
if [[ $mode == fresh ]]; then
 # The install as the installer leaves it: no people, no Company, the setup claim open, the Engine record waiting.
 env -u NEXT_PUBLIC_SUPABASE_URL node --input-type=module \
  -e "import { resetFirstRun } from './scripts/first-run-db.mjs'; resetFirstRun('$origin');" \
  2> "$state/reset.log" || { cat "$state/reset.log" >&2; exit 1; }
fi
# The setup code this app opens first run with; cloud:verify reads it here.
setup_code=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
(umask 077; printf '%s\n' "$setup_code" > "$state/setup-code")

setsid nohup node scripts/cloud-hermes.mjs > "$state/hermes.log" 2>&1 < /dev/null &
echo $! > "$state/hermes.pid"
SETUP_CODE=$setup_code setsid nohup bash scripts/web.sh > "$state/web.log" 2>&1 < /dev/null &
echo $! > "$state/web.pid"

echo "Starting the app at $origin (scripts/web.sh; log $state/web.log)…"
for _ in $(seq 1 240); do
 if curl -fsS -o /dev/null "$origin/sign-in" 2> /dev/null; then break; fi
 if ! kill -0 "$(cat "$state/web.pid")" 2> /dev/null; then echo 'the app stopped while starting:' >&2; tail -30 "$state/web.log" >&2; exit 1; fi
 sleep 1
done
curl -fsS -o /dev/null "$origin/sign-in" || { echo "the app did not answer at $origin/sign-in within 4 minutes" >&2; tail -30 "$state/web.log" >&2; exit 1; }

signed_in=''
if [[ $mode == up ]]; then
 # The proof a person can use it: the seeded Owner signs in with a browser and reaches a signed-in page.
 signed_in=$(node scripts/cloud-verify.mjs --sign-in)
fi

cat << EOF

gtmworks is running at $origin
EOF
if [[ $mode == up ]]; then
 cat << EOF
  Sign in as the seeded Owner: $seeded_email / $seeded_password
  (every seeded person in supabase/seed.sql has that password; manager@, reviewer@ and viewer@example.com too)
  $signed_in
EOF
else
 cat << EOF
  Fresh install: open the setup link to create the Owner and the first Company:
  $origin/first-run#code=$setup_code
EOF
fi
cat << EOF
  Local database:  postgresql://postgres:postgres@127.0.0.1:54322/postgres
  Local inbox:     http://127.0.0.1:54324 (sign-in and invite emails land here)
  Logs:            $state/web.log, $state/hermes.log
  Walk the journey: npm run cloud:verify    Stop: npm run cloud:down
EOF
