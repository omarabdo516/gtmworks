#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The production shape: the production image behind a Caddy reverse proxy on a real-looking host name over HTTPS,
# as on a public install behind HTTPS. Playwright starts this script and waits for the line "PROXY STACK READY".
# It needs the local Supabase stack (scripts/local-db.sh) and the image gtmworks:ci (scripts/ci-image.sh builds it).
host=app.gtmworks.test
work=$(mktemp -d)
stop_containers() { docker rm -f gtmworks-proxy-app gtmworks-proxy-caddy >/dev/null 2>&1 || true; docker volume rm gtmworks-proxy-caddy-data >/dev/null 2>&1 || true; }
trap 'stop_containers; rm -rf "$work"' EXIT INT TERM
stop_containers
[[ -n "$(docker image ls -q gtmworks:ci)" ]] || docker build -t gtmworks:ci .
status=$(npx supabase status -o env)
api_url=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
service_key=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
jwt_secret=$(printf '%s\n' "$status" | sed -n 's/^JWT_SECRET="\(.*\)"$/\1/p')
jwt_secret=${jwt_secret:-super-secret-jwt-token-with-at-least-32-characters-long}
anon_key=$(JWT_SECRET="$jwt_secret" node -e 'const c=require("crypto"); const b=x=>Buffer.from(JSON.stringify(x)).toString("base64url"); const p=b({alg:"HS256",typ:"JWT"})+"."+b({role:"anon",iss:"supabase-demo",exp:4102444800}); process.stdout.write(p+"."+c.createHmac("sha256",process.env.JWT_SECRET).update(p).digest("base64url"))')
export NEXT_PUBLIC_SUPABASE_URL="$api_url" NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key"
export SUPABASE_SERVICE_ROLE_KEY="$service_key" SUPABASE_JWT_SECRET="$jwt_secret"
export WEBHOOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= APP_ORIGIN="https://$host"
cat > "$work/Caddyfile" <<CADDY
{
	local_certs
	auto_https disable_redirects
	default_sni $host
}
$host {
	reverse_proxy 127.0.0.1:3000
}
CADDY
docker run -d --name gtmworks-proxy-caddy --network host -v gtmworks-proxy-caddy-data:/data -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 >/dev/null
for attempt in $(seq 1 60); do
  docker exec gtmworks-proxy-caddy cat /data/caddy/pki/authorities/local/root.crt > "$work/root.crt" 2>/dev/null && [[ -s "$work/root.crt" ]] && break
  sleep 1
done
[[ -s "$work/root.crt" ]] || { docker logs gtmworks-proxy-caddy; exit 1; }
chmod 644 "$work/root.crt"
# The server trusts the proxy's certificate authority the way the production server trusts a public one,
# and resolves the public name to this machine.
docker run -d --name gtmworks-proxy-app --network host --add-host "$host:127.0.0.1" -v "$work/root.crt:/ca/root.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca/root.crt \
  -e NEXT_PUBLIC_SUPABASE_URL -e NEXT_PUBLIC_SUPABASE_ANON_KEY -e SUPABASE_SERVICE_ROLE_KEY -e SUPABASE_JWT_SECRET -e WEBHOOK_ENCRYPTION_KEY -e APP_ORIGIN gtmworks:ci >/dev/null
for attempt in $(seq 1 60); do
  curl -fsS --cacert "$work/root.crt" --resolve "$host:443:127.0.0.1" "https://$host/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --cacert "$work/root.crt" --resolve "$host:443:127.0.0.1" "https://$host/api/health" || { docker logs gtmworks-proxy-app; docker logs gtmworks-proxy-caddy; exit 1; }
echo
echo "PROXY STACK READY"
# Keep the server log in the test output: a rejected request leaves its reason here.
docker logs -f gtmworks-proxy-app 2>&1 &
logs=$!
wait "$logs"
