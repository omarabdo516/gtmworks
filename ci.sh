#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The browser suite runs one lane per worker, each on a whole stack of its own (tests/lane.mjs, #69); lane 0 is the stack
# every other check uses. Each lane starts in the background and leaves its exit status beside its log.
lanes=${GTMWORKS_TEST_LANES:-1}
[[ $lanes =~ ^[1-7]$ ]] || { echo 'GTMWORKS_TEST_LANES must be 1 to 7' >&2; exit 2; }
start_lanes() {
  mkdir -p playwright-report
  for ((n = 0; n < lanes; n++)); do
    rm -f "playwright-report/lane-$n.status"
    nohup setsid bash -c 'LANE=$1 bash scripts/local-db.sh > "playwright-report/lane-$1-db.log" 2>&1; echo $? > "playwright-report/lane-$1.status"' _ "$n" < /dev/null > /dev/null 2>&1 &
  done
}
wait_lanes() {
  for ((n = 0; n < lanes; n++)); do
    second=0
    while [[ ! -s "playwright-report/lane-$n.status" ]] && ((second++ < 900)); do sleep 1; done
    if [[ $(cat "playwright-report/lane-$n.status" 2> /dev/null) != 0 ]]; then
      cat "playwright-report/lane-$n-db.log" >&2; echo "browser test lane $n did not start" >&2; exit 1
    fi
  done
}
case "${1:-check}" in
 check)
  # Every stage in order, for local use. CI runs them as parallel jobs, each only when its files change
  # (.github/workflows/ci.yml, scripts/ci-areas.mjs).
  bash ci.sh static
  bash ci.sh components
  bash ci.sh database
  bash ci.sh integration
  ;;
 static)
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  node scripts/check-test-discovery.mjs
  python3 - <<'PY'
import html.parser, pathlib, sys

problems = []
class P(html.parser.HTMLParser):
    pass

for path in sorted(pathlib.Path("design").rglob("*.html")) if pathlib.Path("design").is_dir() else []:
    text = path.read_text(encoding="utf-8")
    try:
        P().feed(text)
    except Exception as exc:  # html.parser is lenient; anything raised is a real break
        problems.append(f"{path}: cannot be parsed ({exc})")
    head = text[:2000].lower()
    if 'dir="rtl"' not in head or 'lang="ar"' not in head:
        problems.append(f"{path}: the <html> tag must carry lang=\"ar\" dir=\"rtl\"")

for adr in sorted(pathlib.Path("docs/adr").glob("*.md")):
    first = adr.read_text(encoding="utf-8").splitlines()[:3]
    if not any(line.startswith("status:") for line in first):
        problems.append(f"{adr}: an ADR starts with a status line")

for p in problems:
    print(p)
print(f"ci.sh check: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
PY
  node scripts/check-i18n.mjs
  npx --yes @redocly/cli@2.76.0 lint docs/api/openapi.yaml --extends=spec
  npm run lint
  npm run typecheck
  # Unused files, exports and dependencies (knip.json), as T3 Code checks them (#81).
  npx --no-install knip --no-progress
  npm test
  ;;
 components)
  # Screens as components in headless Chromium (#81); SHARD (for example 1/2) runs one slice.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  npx playwright install --with-deps chromium
  npm run test:components -- ${SHARD:+--shard="$SHARD"}
  ;;
 database)
  # Migrations replayed and verified, row-level security and grants, on lane 0's stack.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  bash scripts/local-db.sh
  for file in supabase/migrations/*.verify.sql scripts/check-rls.sql; do
    npx --no-install supabase db query --read-only --file "$file" -o json --agent no | node scripts/verify-db.mjs "$file"
  done
  npm run test:db
  ;;
 integration)
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    npx playwright install --with-deps chromium
  fi
  start_lanes
  wait_lanes
  if [[ "${CI:-}" == "true" ]]; then
    bash scripts/ci-image.sh
  fi
  # The browser suite's build is made while lane 0 serves the proxy suite below; lane 0's web server then only starts it.
  (LANE=0 bash scripts/web.sh build > playwright-report/build.log 2>&1) &
  build_pid=$!
  # The production-shaped stack (proxy, https, public-looking host) runs on the database exactly as the seed builds it and
  # changes it (an enrolled authenticator, an invited member), so the seed is rebuilt before the main browser suite.
  npm run test:e2e:proxy
  bash scripts/local-db.sh
  wait "$build_pid" || { cat playwright-report/build.log >&2; echo 'the browser suite build failed' >&2; exit 1; }
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=$lanes npm run test:e2e
  ;;
 visual)
  # The compared screens alone, on lane 0 as the seed builds it: no journeys, no proxy suite, no image (#213).
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    npx playwright install --with-deps chromium
  fi
  bash scripts/local-db.sh
  GTMWORKS_TEST_LANES=1 npm run test:visual
  ;;
 visual-update)
  # Rewrites only the approved screen images that changed. Run it where CI runs: the images are made for that system.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    npx playwright install --with-deps chromium
  fi
  bash scripts/local-db.sh
  npm run test:visual:update
  ;;
 *) echo 'usage: ./ci.sh check | static | components | database | integration | visual | visual-update' >&2; exit 2;;
esac
