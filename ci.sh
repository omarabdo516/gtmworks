#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The browser suite runs one lane per worker, each on a whole stack of its own (tests/lane.mjs, #69); lane 0 is the stack
# every other check uses. Each lane starts in the background and leaves its exit status beside its log.
lanes=${GTMWORKS_TEST_LANES:-1}
[[ $lanes =~ ^[1-7]$ ]] || { echo 'GTMWORKS_TEST_LANES must be 1 to 7' >&2; exit 2; }
install_chromium() {
  # The visual lane's browser and its system packages, as it has always installed them (#257); the browser suite's
  # shards get theirs from the workflow's cache, and install no system package (#404). It starts in the background beside
  # start_lane's npm ci (#359), so it runs the locked Playwright from a folder of its own: npm ci is rewriting the
  # checkout's node_modules meanwhile. The browser lands in the cache the checkout's Playwright reads.
  local version
  version=$(node -p "require('./package-lock.json').packages['node_modules/playwright'].version")
  mkdir -p playwright-report
  (cd "$(mktemp -d)" && npx --yes "playwright@$version" install --with-deps chromium) > playwright-report/chromium.log 2>&1 &
  chromium=$!
}
chromium_installed() {
  wait "$chromium" || { cat playwright-report/chromium.log >&2; echo 'Chromium did not install' >&2; exit 1; }
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
# The fast steps' logs and the visual job's test results go under ci-ledger/<job> (Playwright empties test-results/ when
# it starts); a failed visual job on main reads its results back (scripts/visual-regression.mjs). Prints the folder.
ledger_dir() {
  local dir="ci-ledger/${GITHUB_JOB:-$1}"
  rm -rf "$dir" && mkdir -p "$dir"
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
  bash ci.sh fast
  bash ci.sh database
  bash ci.sh visual
  bash ci.sh integration
  bash ci.sh chat-open
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
  node scripts/ci-fast.mjs "$dir" ${chosen[@]+"${chosen[@]}"}
  ;;
 database)
  # Migrations replayed and verified, row-level security and grants, on lane 0's stack.
  load_images
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  images_loaded
  bash scripts/local-db.sh
  # Every verify file in one psql session, each reported by name (#259).
  container=$(< supabase/.temp/lanes/0/db-container)
  node scripts/verify-db-session.mjs "$container" supabase/migrations/*.verify.sql scripts/check-rls.sql
  # The session itself, on real psql: a file whose statement fails must fail with that statement's error.
  if canary=$(node scripts/verify-db-session.mjs "$container" tests/verify-db-session-canary.sql 2>&1) \
    || [[ $canary != *'tests/verify-db-session-canary.sql: division by zero'* ]]; then
    echo "$canary" >&2; echo 'the verify session did not fail its canary with its error' >&2; exit 1
  fi
  echo 'verify session canary: a failed statement failed its file with its error, as it must'
  npm run test:db
  ;;
 integration)
  # Any further arguments go to the browser suite; CI passes --shard=<i>/6 (#335, #404), and the proxy suite runs in
  # shard 1 only.
  shift
  proxy=true
  [[ " $* " == *' --shard='* && " $* " != *' --shard=1/'* ]] && proxy=false
  # CI restores the dependencies and the browser from the fast job's caches before this, and installs Chromium alone on
  # a miss: the runner image has its system packages and fonts, so nothing here reaches a package mirror (#404). A local
  # run uses the checkout's own node_modules and browser.
  load_images
  images_loaded
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
  if [[ $proxy == true ]]; then npm run test:e2e:proxy; fi
  bash scripts/local-db.sh
  wait "$build_pid" || { cat playwright-report/build.log >&2; echo 'the browser suite build failed' >&2; exit 1; }
  # The measured budgets run on their own (`ci.sh visual`), on a GitHub-hosted runner.
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=$lanes GTMWORKS_HOSTED_ELSEWHERE=true npm run test:e2e -- "$@"
  ;;
 chat-open)
  # The chat's open time (project `alone`, #346) with a machine to itself, on the pull request too (#421): one lane's
  # stack, one build of the app and the one test, whose budget is one second (decision 0042).
  lanes=1
  # CI restores the dependencies and the browser from the fast job's caches before this, as the shards do (#404).
  load_images
  images_loaded
  start_lanes
  wait_lanes
  LANE=0 bash scripts/web.sh build
  GTMWORKS_WEB_PREBUILT=true GTMWORKS_TEST_LANES=1 npx playwright test --project=alone --no-deps
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
  # which need a machine of their own (#224). In CI the budgets' browser installs beside the lane (#359).
  if [[ "${CI:-}" == "true" ]]; then
    install_chromium
  fi
  start_lane
  dir=$(ledger_dir visual)
  status=0
  PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/lane.json" lane_test || status=$?
  if [[ "${CI:-}" == "true" ]]; then
    chromium_installed
  fi
  # Its own output folder: Playwright empties the one it writes to, and test-results/lane/ holds the lane's differences.
  # The budgets serve the build the lane's web server made; with none (the lane stopped before it), they build their own.
  GTMWORKS_WEB_PREBUILT=$([[ -f .next/BUILD_ID ]] && echo true || echo false) GTMWORKS_TEST_LANES=1 PLAYWRIGHT_JSON_OUTPUT_FILE="$dir/measured.json" npx playwright test --project=measured --no-deps --output=test-results/measured || status=$?
  exit "$status"
  ;;
 visual-update)
  # Rewrites only the lane's images that changed; the pinned renderer draws them the same on every machine.
  start_lane
  lane_test --update-snapshots=changed
  ;;
 install)
  # One area of the install proof (scripts/ci-install-check.sh, #406) on an isolated Docker machine of its own, in a
  # throwaway checkout of HEAD: `./ci.sh install proxy` runs the proxy area alone; without an area the whole proof and
  # the profile-size measurement (#408) run.
  # The proof writes into the checkout it runs in, as it does on a CI runner, so commit first: uncommitted changes are
  # not run. The work folder sits under the git directory: the Docker machine hides /tmp, so a checkout there reaches
  # its containers empty.
  # The proof is Docker only, so without a daemon say what is missing in one line, before a machine is started.
  shift
  docker info > /dev/null 2>&1 || { echo 'the install proof needs Docker: docker info cannot reach a daemon' >&2; exit 1; }
  # The update area updates an install from HEAD's source, which an update downloads from GitHub: HEAD must be pushed to some branch.
  git fetch -q origin "$(git rev-parse HEAD)" 2> /dev/null \
    || { echo "Push HEAD to a branch on GitHub first: the install job downloads it ($(git rev-parse --short HEAD))." >&2; exit 2; }
  work=$(mktemp -d "$(git rev-parse --absolute-git-dir)/install-lane.XXXXXX"); dind=gtmworks-install-lane; port=${INSTALL_DOCKER_PORT:-2375}; here=$PWD
  git worktree add -q --detach "$work/src" HEAD
  trap 'docker rm -fv "$dind" > /dev/null 2>&1 || true; git -C "$here" worktree remove --force "$work/src" > /dev/null 2>&1 || true; rm -rf "$work" 2> /dev/null || true' EXIT
  # One install lane at a time on this machine: a machine an interrupted run left behind is removed first.
  docker rm -fv "$dind" > /dev/null 2>&1 || true
  docker run -d --privileged --name "$dind" -e DOCKER_TLS_CERTDIR= -p "127.0.0.1:$port:2375" -v "$work/src:$work/src" docker:28.5.1-dind > /dev/null
  host_docker=${DOCKER_HOST:-}
  export DOCKER_HOST=tcp://127.0.0.1:$port RUNNER_TEMP=$work/tmp INSTALL_REF
  INSTALL_REF=$(git rev-parse HEAD)
  mkdir -p "$RUNNER_TEMP"
  for attempt in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
  docker info > /dev/null
  # Pulls inside this machine stall here (the nested network behind rootless Docker), so every image the job runs comes
  # from this host's Docker: pulled here once when missing, then loaded in, by digest where the install pins one.
  images=$( { grep -h -E '^[[:space:]]*image:' docker-compose.install.yml scripts/engine-template.yml | awk '{print $2}' | grep -v '^gtmworks-local' | grep -v '\$'
    awk '/^FROM/ && $2 ~ /[:@]/ {print $2}' Dockerfile
    grep -o -h -E '(alpine:[0-9.]+|node:[0-9][0-9a-z.-]*|curlimages/curl:[0-9.]+|registry:[0-9.]+|mcr\.microsoft\.com/playwright:[^ "]+)' scripts/ci-install-check.sh scripts/install.sh scripts/get.sh; } | sort -u)
  # The work sandbox image every Company's sandbox runs (#392, #393): CI builds it in the run's image job and loads that
  # build; here it is built on this host from the committed checkout's sandbox/Dockerfile on every run (Docker reuses the
  # layers that did not change), so the lane runs HEAD's image, never an earlier commit's tag or uncommitted files.
  # The exit runs the same image (#394), so the template names it twice: the first is the sandbox's.
  sandbox_tag=$(sed -n 's/^ *image: ${SANDBOX_IMAGE:-\(.*\)}$/\1/p' scripts/engine-template.yml | head -n 1)
  DOCKER_HOST=$host_docker docker build -q -t "$sandbox_tag" "$work/src/sandbox" > /dev/null
  images="$images $sandbox_tag"
  # Behind an HTTPS proxy (a cloud session) Node reaches GitHub through it, as curl and git do.
  [[ -z ${HTTPS_PROXY:-}${https_proxy:-} ]] || export NODE_USE_ENV_PROXY=1
  # The release-update area installs the latest published release, whose files pin images of their own (#483): read
  # from the same releases list the area reads, pulled here and loaded in with the rest.
  if [[ -z ${1:-} || $1 == release-update ]]; then
    node --no-warnings scripts/latest-release.mjs "$work/latest-release" > /dev/null
    images="$images $(grep -h -E '^[[:space:]]*image:' "$work/latest-release/docker-compose.install.yml" | awk '{print $2}' | grep -v '\$' | sort -u | tr '\n' ' ')"
  fi
  for image in $images; do DOCKER_HOST=$host_docker docker image inspect "$image" > /dev/null 2>&1 || DOCKER_HOST=$host_docker docker pull -q "$image" > /dev/null; done
  DOCKER_HOST=$host_docker docker save $images | docker load > /dev/null
  # The job's containers see only the checkout, so the test packages are a hard-linked copy in it, not a link out of it
  # (CI installs them there with npm ci).
  cp -al "$(readlink -f "$here/node_modules")" "$work/src/node_modules"
  cd "$work/src"
  # Under rootless Docker this machine's root is the invoking user and its `--user $(id -u)` is another one, unlike a CI
  # runner or a server: files the job makes are left writable to every user, so a container run as the user can write them.
  umask 0000
  export INSTALL_LANE_FOREIGN_OWNER=1
  bash scripts/ci-install-check.sh "$@"
  ;;
  *) echo 'usage: ./ci.sh check | fast | static | components | database | images | integration | chat-open | visual | visual-update | install [first-install | companies | agents | backup | proxy | rollback | update | previous-archive | release-update | sandbox-update | staged-update | sizes | engines-update | one-line | updater | measure]' >&2; exit 2;;
esac
