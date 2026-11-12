#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# CI builds the image first with a layer cache (CI_IMAGE_PREBUILT=true); a local run builds it here.
[[ "${CI_IMAGE_PREBUILT:-}" == "true" ]] || docker build -t gtmworks:ci .
status=$(npx supabase status -o env)
api_url=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
service_key=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
jwt_secret=$(printf '%s\n' "$status" | sed -n 's/^JWT_SECRET="\(.*\)"$/\1/p')
jwt_secret=${jwt_secret:-super-secret-jwt-token-with-at-least-32-characters-long}
# Sign a local anonymous token distinct from the rejected development fallback.
anon_key=$(JWT_SECRET="$jwt_secret" node -e 'const c=require("crypto"); const b=x=>Buffer.from(JSON.stringify(x)).toString("base64url"); const p=b({alg:"HS256",typ:"JWT"})+"."+b({role:"anon",iss:"supabase-demo",exp:4102444800}); process.stdout.write(p+"."+c.createHmac("sha256",process.env.JWT_SECRET).update(p).digest("base64url"))')
export NEXT_PUBLIC_SUPABASE_URL="$api_url" NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key"
export SUPABASE_SERVICE_ROLE_KEY="$service_key" SUPABASE_JWT_SECRET="$jwt_secret"
export WEBHOOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= APP_ORIGIN=https://example.test
args=(--network host -e NEXT_PUBLIC_SUPABASE_URL -e NEXT_PUBLIC_SUPABASE_ANON_KEY -e SUPABASE_SERVICE_ROLE_KEY -e SUPABASE_JWT_SECRET -e WEBHOOK_ENCRYPTION_KEY -e APP_ORIGIN)
trap 'docker rm -f gtmworks-ci gtmworks-worker-ci >/dev/null 2>&1 || true' EXIT
docker run -d --name gtmworks-ci "${args[@]}" gtmworks:ci >/dev/null
docker run -d --name gtmworks-worker-ci "${args[@]}" gtmworks:ci npm run worker >/dev/null
healthy=false
for attempt in $(seq 1 30); do
  if body=$(curl -fsS http://127.0.0.1:3000/api/health) && printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try {const p=JSON.parse(s);process.exit(p.ok===true && p.db===true && typeof p.version==="string" ? 0 : 1)} catch {process.exit(1)}})'; then
    healthy=true
    break
  fi
  sleep 1
done
# Let the worker perform at least one poll, and fail if it exits or logs a worker error.
sleep 3
if [[ "$healthy" != true ]] || [[ $(docker inspect -f '{{.State.Running}}' gtmworks-worker-ci) != true ]] || docker logs gtmworks-worker-ci 2>&1 | grep -q 'Webhook worker:'; then
  docker logs gtmworks-ci
  docker logs gtmworks-worker-ci
  exit 1
fi
