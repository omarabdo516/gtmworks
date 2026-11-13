#!/bin/sh
# A failed install check prints a summary of the web and gateway logs before the install is torn down
# (.github/workflows/ci.yml). Logs pass only through scripts/log-summary.mjs, which prints counted fixed fields and never
# log text, and prints nothing when it cannot run. The caller keeps its own exit status whatever this returns.
for service in web gateway; do
  echo "--- $service log summary ---" >&2
  docker compose --env-file .env.install -f docker-compose.install.yml logs --no-color --no-log-prefix --tail 300 "$service" 2>/dev/null |
    docker run --rm -i -v "$PWD:/install:ro" node:22.14.0-alpine3.21 \
      node /install/scripts/log-summary.mjs "$service" /install/app /install/package.json >&2 ||
    echo "$service summary unavailable" >&2
done
