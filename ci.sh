#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The browser suite runs one lane per worker, each on a whole stack of its own (tests/lane.mjs, #69); lane 0 is the stack
# every other check uses. Each lane starts in the background and leaves its exit status beside its log.
lanes=${GTMWORKS_TEST_LANES:-1}
[[ $lanes =~ ^[1-7]$ ]] || { echo 'GTMWORKS_TEST_LANES must be 1 to 7' >&2; exit 2; }
# The self-hosted runner has no sudo for the system packages and keeps its browsers between runs.
install_chromium() {
  if [[ "${RUNNER_ENVIRONMENT:-}" == self-hosted ]]; then npx playwright install chromium; else npx playwright install --with-deps chromium; fi
}
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
# The cached Supabase images load while the packages install, and the stage ends by saying how many images the registry
# served (scripts/supabase-images.sh, #259).
load_images() {
  bash scripts/supabase-images.sh load &
  images_pid=$!
}
images_loaded() {
  wait "$images_pid" || echo 'supabase images: the cached archive did not load' >&2
  images_before=$(mktemp)
  bash scripts/supabase-images.sh list > "$images_before"
  trap 'bash scripts/supabase-images.sh pulled "$images_before" || true; rm -f "$images_before"' EXIT
}
# Each stage writes its machine-readable test results under ci-ledger/ (Playwright empties test-results/ when it starts);
# the ledger job reads them back (scripts/ci-ledger.mjs, #256). Prints the folder.
ledger_dir() {
  local dir="ci-ledger/${GITHUB_JOB:-$1}${SHARD:+-${SHARD%%/*}}"
  rm -rf "$dir" && mkdir -p "$dir"
  LAYER=$1 node -e 'const env = process.env; console.log(JSON.stringify({ layer: env.LAYER, shard: env.SHARD ?? "", runner: env.RUNNER_NAME ?? "local", environment: env.RUNNER_ENVIRONMENT ?? "local", root: process.cwd() }))' > "$dir/meta.json"
  echo "$dir"
}
# The visual lane (#257) is drawn by one pinned browser in its container, through Playwright's own server (the checkout's
# locked package, so nothing is downloaded); the tests, the app and lane 0's stack stay on this machine. The image pulls
# while the dependencies install and the stack starts.
renderer=gtmworks-lane-renderer
renderer_port=3900
start_lane() {
  local lanes=1 image pull
  image=$(< tests/visual-lane/renderer)
  mkdir -p playwright-report
  docker pull --quiet "$image" > playwright-report/renderer.log 2>&1 &
  pull=$!
  load_images
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  images_loaded
  start_lanes
  wait_lanes
  wait "$pull" || { cat playwright-report/renderer.log >&2; echo 'the renderer image did not pull' >&2; exit 1; }
  docker rm --force "$renderer" > /dev/null 2>&1 || true
  # One exit handler for both: images_loaded's report of what was pulled, and the renderer taken away.
  trap 'docker rm --force "$renderer" > /dev/null 2>&1 || true; bash scripts/supabase-images.sh pulled "$images_before" || true; rm -f "$images_before"' EXIT
  # -i: the server stops when its standard input closes. --unsafe: it takes the launch flags the lane's config sends.
  docker run --detach --interactive --name "$renderer" --init --ipc=host -p "127.0.0.1:$renderer_port:$renderer_port" \
    -v "$PWD:/work:ro" -w /work "$image" \
    node node_modules/playwright/cli.js run-server --port "$renderer_port" --host 0.0.0.0 --unsafe > /dev/null
  # Docker opens the port before the server inside listens, so the server's own line says it is ready.
  second=0
  until docker logs "$renderer" 2>&1 | grep -q '^Listening on'; do
    if ((second++ >= 60)); then docker logs "$renderer" >&2; echo 'the renderer did not start' >&2; exit 1; fi
    sleep 1
  done
}
lane_test() {
  GTMWORKS_TEST_LANES=1 GTMWORKS_LANE_RENDERER="ws://127.0.0.1:$renderer_port/" npx playwright test -c playwright.lane.config.ts "$@"
}
case "${1:-check}" in
 check)
  # Every stage in order, for local use. CI runs them as parallel jobs, each only when its files change
  # (.github/workflows/ci.yml, scripts/ci-areas.mjs).
  bash ci.sh static
  bash ci.sh components
  bash ci.sh database
  bash ci.sh visual
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
  dir=$(ledger_dir static)
  # `npm test`'s files, with the ledger reporter beside the usual one; the flags must come before the glob.
  node --test --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=./scripts/ci-ledger-node.mjs --test-reporter-destination="$dir/node.jsonl" 'tests/**/*.test.mjs'
  ;;
 components)
  # Screens as components in headless Chromium (#81); SHARD (for example 1/2) runs one slice.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  install_chromium
  dir=$(ledger_dir components)
  # Naming the reporters replaces Vitest's own choice, so the GitHub one that marks failures on the pull request is named
  # too when it runs there.
  npm run test:components -- ${SHARD:+--shard="$SHARD"} --reporter=default ${GITHUB_ACTIONS:+--reporter=github-actions} \
    --reporter=json --outputFile.json="$dir/vitest.json"
  ;;
 database)
  # Migrations replayed and verified, row-level security and grants, on lane 0's stack.
  load_images
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  images_loaded
  bash scripts/local-db.sh
  dir=$(ledger_dir database)
  # Every verify file in one psql session, each reported by name with its own ledger line (#259).
  container=$(< supabase/.temp/lanes/0/db-container)
  DB_LEDGER="$PWD/$dir/database.jsonl" node scripts/verify-db-session.mjs "$container" supabase/migrations/*.verify.sql scripts/check-rls.sql
  # The session itself, on real psql: a file whose statement fails must fail with that statement's error.
  if canary=$(node scripts/verify-db-session.mjs "$container" tests/verify-db-session-canary.sql 2>&1) \
    || [[ $canary != *'tests/verify-db-session-canary.sql: division by zero'* ]]; then
    echo "$canary" >&2; echo 'the verify session did not fail its canary with its error' >&2; exit 1
  fi
  echo 'verify session canary: a failed statement failed its file with its error, as it must'
  # tests/db.sh writes one line per step of its own.
  DB_LEDGER="$PWD/$dir/database.jsonl" npm run test:db
  ;;
 integration)
  load_images
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    install_chromium
  fi
  images_loaded
  dir=$(ledger_dir integration)
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
  PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/proxy.json" npm run test:e2e:proxy
  bash scripts/local-db.sh
  wait "$build_pid" || { cat playwright-report/build.log >&2; echo 'the browser suite build failed' >&2; exit 1; }
  # The measured budgets run on their own (`ci.sh visual`), on a GitHub-hosted runner.
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=$lanes GTMWORKS_HOSTED_ELSEWHERE=true PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/e2e.json" npm run test:e2e
  ;;
 images)
  # Every Supabase image the jobs use, pulled once and archived for the Actions cache (the supabase-images job, #259).
  # The stack starts on an empty project with this configuration (no migrations, an empty seed), so a broken migration
  # cannot stop the archive; one throwaway test pulls pgTAP's runner.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  project=$(mktemp -d)
  mkdir -p "$project/supabase"
  cp supabase/config.toml "$project/supabase/"
  : > "$project/supabase/seed.sql"
  npx --no-install supabase start --workdir "$project"
  printf '%s\n' 'begin;' 'create extension if not exists pgtap with schema extensions;' 'select plan(1);' \
    "select pass('the pgTAP runner is here');" 'select * from finish();' 'rollback;' > "$project/images.sql"
  npx --no-install supabase test db --workdir "$project" "$project/images.sql"
  bash scripts/supabase-images.sh save
  ;;
 visual)
  # The visual lane's key screens on the pinned renderer, and its guard tests (#257). Then the navigation time budgets,
  # which need a machine of their own (#224).
  start_lane
  dir=$(ledger_dir visual)
  status=0
  PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/lane.json" lane_test || status=$?
  if [[ "${CI:-}" == "true" ]]; then
    install_chromium
  fi
  # Its own output folder: Playwright empties the one it writes to, and test-results/lane/ holds the lane's differences.
  # The lane's web server built the app; the budgets serve that build.
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=1 PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/measured.json" npx playwright test --project=measured --no-deps --output=test-results/measured || status=$?
  exit "$status"
  ;;
 visual-update)
  # Rewrites only the lane's images that changed; the pinned renderer draws them the same on every machine.
  start_lane
  lane_test --update-snapshots=changed
  ;;
 lane-proof)
  # Draws every lane image three times and keeps each run's hashes: CI compares them across runners. It rewrites the
  # approved images in the checkout, so it runs in CI only.
  [[ "${CI:-}" == "true" ]] || { echo 'lane-proof rewrites the approved lane images; it runs in CI only' >&2; exit 2; }
  start_lane
  mkdir -p test-results/lane-proof
  # Each run's images are kept beside its hashes, so a difference can be looked at. The first run builds the app and the
  # next two serve that build; the second declares the screens last to first, so
  # the same bytes also prove that no screen depends on the ones drawn before it.
  lane_test --update-snapshots=all
  find tests/visual-lane -name '*.png' | sort | xargs -r sha256sum > test-results/lane-proof/run-1.sha256
  cp -r tests/visual-lane/images test-results/lane-proof/run-1-images
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_LANE_REVERSE=true lane_test --update-snapshots=all
  find tests/visual-lane -name '*.png' | sort | xargs -r sha256sum > test-results/lane-proof/run-2.sha256
  cp -r tests/visual-lane/images test-results/lane-proof/run-2-images
  GTMWORKS_WEB_PREBUILT=true lane_test --update-snapshots=all
  find tests/visual-lane -name '*.png' | sort | xargs -r sha256sum > test-results/lane-proof/run-3.sha256
  cp -r tests/visual-lane/images test-results/lane-proof/run-3-images
  ;;
 *) echo 'usage: ./ci.sh check | static | components | database | images | integration | visual | visual-update | lane-proof' >&2; exit 2;;
esac
