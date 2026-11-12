#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Local-only credentials supplied by the local Supabase stack.
status=$(npx supabase status -o env)
export NEXT_PUBLIC_SUPABASE_URL=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(printf '%s\n' "$status" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
export SUPABASE_SERVICE_ROLE_KEY=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
local_jwt_secret=$(printf '%s\n' "$status" | sed -n 's/^JWT_SECRET="\(.*\)"$/\1/p')
export SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET:-${local_jwt_secret:-super-secret-jwt-token-with-at-least-32-characters-long}}
export WEBHOOK_ENCRYPTION_KEY=${WEBHOOK_ENCRYPTION_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}
export APP_ORIGIN=${APP_ORIGIN:-http://127.0.0.1:3000}
# Production e2e uses the local stack while retaining the production settings guard. Links are built on APP_ORIGIN, so it
# is the address the browser uses; the guard accepts a plain-http loopback origin only in the local install's shape.
if [[ "${1:-dev}" == "production" ]]; then
 export APP_ORIGIN=http://127.0.0.1:3000 GTMWORKS_SELF_HOSTED=true SUPABASE_PUBLIC_URL="$NEXT_PUBLIC_SUPABASE_URL"
fi
node worker/index.mjs &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
if [[ "${1:-dev}" == "production" ]]; then
 npm run build
 npx next start
else
 npx next dev
fi
