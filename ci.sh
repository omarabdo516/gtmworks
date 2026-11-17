#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The browser suite runs one lane per worker, each on a whole stack of its own (tests/lane.mjs, #69); lane 0 is the stack
# every other check uses. Each lane starts in the background and leaves its exit status beside its log.
lanes=${GTMWORKS_TEST_LANES:-1}
[[ $lanes =~ ^[1-7]$ ]] || { echo 'GTMWORKS_TEST_LANES must be 1 to 7' >&2; exit 2; }
# Only a GitHub-hosted runner installs the system packages (it has sudo and starts empty); the self-hosted runner and a
# person's machine keep theirs, and their browsers, between runs.
install_chromium() {
  if [[ "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]; then npx playwright install --with-deps chromium; else npx playwright install chromium; fi
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
# Each stage writes its machine-readable test results under ci-ledger/ (Playwright empties test-results/ when it starts);
# the ledger job reads them back (scripts/ci-ledger.mjs, #256). Prints the folder.
ledger_dir() {
  local dir="ci-ledger/${GITHUB_JOB:-$1}${SHARD:+-${SHARD%%/*}}"
  rm -rf "$dir" && mkdir -p "$dir"
  LAYER=$1 node -e 'const env = process.env; console.log(JSON.stringify({ layer: env.LAYER, shard: env.SHARD ?? "", runner: env.RUNNER_NAME ?? "local", environment: env.RUNNER_ENVIRONMENT ?? "local", root: process.cwd() }))' > "$dir/meta.json"
  echo "$dir"
}
# One database ledger line per check; a failed check still fails the stage, after its line is written.
database_record() {
  local file=$1 name=$2 started=$3 status=$4 outcome=passed
  ((status == 0)) || outcome=failed
  printf '{"suite":"database","file":"%s","name":"%s","duration_ms":%d,"outcome":"%s","retries":0}\n' \
    "$file" "$name" $(( ($(date +%s%N) - started) / 1000000 )) "$outcome" >> "$dir/database.jsonl"
  ((status == 0)) || exit "$status"
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
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  start_lanes
  wait_lanes
  wait "$pull" || { cat playwright-report/renderer.log >&2; echo 'the renderer image did not pull' >&2; exit 1; }
  docker rm --force "$renderer" > /dev/null 2>&1 || true
  trap 'docker rm --force "$renderer" > /dev/null 2>&1 || true' EXIT
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
  bash ci.sh fast
  bash ci.sh database
  bash ci.sh visual
  bash ci.sh lane
  bash ci.sh integration
  ;;
 fast | static | components)
  # The fast layer's steps at the same time, each with its own result (scripts/ci-fast.mjs, #258): `static` leaves out
  # the component tests and `components` runs only them. CI restores the dependencies and the browser before this
  # (.github/workflows/ci.yml), and COMPONENTS=false, the first job's answer, skips the component tests.
  dir=$(ledger_dir "$1")
  case $1 in
   fast) if [[ ${COMPONENTS:-} == false ]]; then chosen=(--skip components); else chosen=(); fi;;
   static) chosen=(--skip components);;
   components) chosen=(--only components);;
  esac
  # CI restores or installs the browser before this step; elsewhere it is installed here when the component tests run.
  if [[ ${CI:-} != true && ${chosen[*]-} != '--skip components' ]]; then install_chromium; fi
  node scripts/ci-fast.mjs "$dir" ${chosen[@]+"${chosen[@]}"}
  ;;
 database)
  # Migrations replayed and verified, row-level security and grants, on lane 0's stack.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  bash scripts/local-db.sh
  dir=$(ledger_dir database)
  for file in supabase/migrations/*.verify.sql scripts/check-rls.sql; do
    started=$(date +%s%N) status=0
    npx --no-install supabase db query --read-only --file "$file" -o json --agent no | node scripts/verify-db.mjs "$file" || status=$?
    database_record "$file" verify "$started" "$status"
  done
  # tests/db.sh writes one line per step of its own.
  DB_LEDGER="$PWD/$dir/database.jsonl" npm run test:db
  ;;
 integration)
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    install_chromium
  fi
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
  # The compared screens and the measured budgets run on their own (`ci.sh visual`), on a GitHub-hosted runner.
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=$lanes GTMWORKS_HOSTED_ELSEWHERE=true PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/e2e.json" npm run test:e2e
  ;;
 visual)
  # The compared screens alone, on lane 0 as the seed builds it: no journeys, no proxy suite, no image (#213). Then the
  # navigation time budgets, which need a machine of their own (#224).
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    install_chromium
  fi
  bash scripts/local-db.sh
  dir=$(ledger_dir visual)
  GTMWORKS_TEST_LANES=1 PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/screens.json" npm run test:visual
  GTMWORKS_TEST_LANES=1 PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/measured.json" npx playwright test --project=measured --no-deps
  ;;
 visual-update)
  # Rewrites only the approved screen images that changed. Run it where CI runs: the images are made for that system.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    install_chromium
  fi
  bash scripts/local-db.sh
  npm run test:visual:update
  ;;
 lane)
  # The lane's screens against their approved images, and its guard tests.
  start_lane
  dir=$(ledger_dir lane)
  PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/lane.json" lane_test
  ;;
 lane-update)
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
  for run in 1 2 3; do
    lane_test --update-snapshots=all
    find tests/visual-lane -name '*.png' | sort | xargs -r sha256sum > "test-results/lane-proof/run-$run.sha256"
  done
  ;;
 *) echo 'usage: ./ci.sh check | fast | static | components | database | integration | visual | visual-update | lane | lane-update | lane-proof' >&2; exit 2;;
esac
