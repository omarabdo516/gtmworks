#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# LANE=n (n > 0) serves browser test lane n (tests/lane.mjs, #69): its own stack (scripts/local-db.sh) on port 3000+n,
# from the build lane 0 made just before it.
lane=${LANE:-0}
[[ $lane =~ ^[0-6]$ ]] || { echo 'LANE must be 0 to 6' >&2; exit 2; }
port=$((3000 + lane))
if [[ $lane != 0 ]]; then export SUPABASE_WORKDIR="$PWD/supabase/.temp/lanes/$lane"; fi
# Local-only credentials supplied by the local Supabase stack.
status=$(npx supabase status -o env)
export NEXT_PUBLIC_SUPABASE_URL=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(printf '%s\n' "$status" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
export SUPABASE_SERVICE_ROLE_KEY=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
local_jwt_secret=$(printf '%s\n' "$status" | sed -n 's/^JWT_SECRET="\(.*\)"$/\1/p')
export SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET:-${local_jwt_secret:-super-secret-jwt-token-with-at-least-32-characters-long}}
export WEBHOOK_ENCRYPTION_KEY=${WEBHOOK_ENCRYPTION_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}
export APP_ORIGIN=${APP_ORIGIN:-http://127.0.0.1:$port}
# First run opens only with the setup code (issue #50); a local run without one gets a fresh code and its link.
if [[ -z "${SETUP_CODE:-}" ]]; then
 export SETUP_CODE=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
 echo "Local setup link: $APP_ORIGIN/first-run#code=$SETUP_CODE"
fi
# Production e2e uses the local stack while retaining the production settings guard. Links are built on APP_ORIGIN, so it
# is the address the browser uses; the guard accepts a plain-http loopback origin only in the local install's shape.
if [[ "${1:-dev}" == "production" || "${1:-dev}" == "build" ]]; then
 export APP_ORIGIN=http://127.0.0.1:$port GTMWORKS_SELF_HOSTED=true SUPABASE_PUBLIC_URL="$NEXT_PUBLIC_SUPABASE_URL"
fi
# `web.sh build` only builds, with the same settings, so CI can build while other checks run (ci.sh integration).
if [[ "${1:-dev}" == "build" ]]; then exec npm run build; fi
# The bundled Hermes is the only Hermes (#342): a lane's app and worker are given its address and key, where a browser
# spec starts its fake Hermes (tests/lane.mjs hermesHostOf). The worker keeps no profiles here, as a hosted one keeps none.
export BUNDLED_HERMES_URL=${BUNDLED_HERMES_URL:-http://127.0.0.$((110 + lane)):8642} HERMES_API_KEY=${HERMES_API_KEY:-test-only-key}
GTMWORKS_SELF_HOSTED= node worker/index.mjs &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
if [[ "${1:-dev}" == "production" ]]; then
 # The build fetches the Google fonts (app/layout.tsx), so a browser test run builds without its offline guard, which
 # then covers the worker and the server (playwright.config.ts).
 if [[ $lane == 0 && "${GTMWORKS_WEB_PREBUILT:-}" != true ]]; then NODE_OPTIONS=${GTMWORKS_BUILD_NODE_OPTIONS-${NODE_OPTIONS:-}} npm run build; fi
 npx next start -p "$port"
else
 npx next dev -p "$port"
fi
