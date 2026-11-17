#!/usr/bin/env bash
set -euo pipefail
# With DB_LEDGER set (ci.sh database), each step appends one CI ledger line (#256); a failing step still ends the script
# with its own status, after its line is written.
record() {
  [[ -z ${DB_LEDGER:-} ]] || printf '{"suite":"database","file":"%s","name":"%s","duration_ms":%d,"outcome":"%s","retries":0}\n' \
    "$1" "$2" "$3" "$4" >> "$DB_LEDGER"
}
step() {
  local file=$1 name=$2 started status=0
  shift 2
  started=$(date +%s%N)
  "$@" || status=$?
  record "$file" "$name" $(( ($(date +%s%N) - started) / 1000000 )) "$( ((status == 0)) && echo passed || echo failed)"
  return "$status"
}
# The allowlist is the single source of truth for shared tables.
python3 - <<'PY'
from pathlib import Path
allowed = [x.strip() for x in Path('supabase/shared-tables.txt').read_text().splitlines() if x.strip() and not x.startswith('#')]
sql = Path('supabase/tests/foundation.sql').read_text()
expected = ','.join("'" + x.replace("'", "''") + "'" for x in allowed)
if f'c.relname not in ({expected})' not in sql:
    raise SystemExit('shared table allowlist and schema check disagree')
PY
step supabase/tests pgTAP npx supabase test db
# The migration replays write their pgTAP files here and run in one session: a `supabase test db` each cost about two
# seconds of start-up for milliseconds of SQL (#259). pg_prove runs the files in name order, not the order below; each
# rolls back its own transaction, so no replay sees another's changes. Side by side their schema changes would lock each
# other. Each replay gets a ledger line with its own outcome and time, read from pg_prove's line for its file: every
# line of the session is stamped as it arrives, and a replay's time runs from the result before it to its own.
replays=$(mktemp -d)
session=$(mktemp)
trap 'rm -rf "$replays" "$session"' EXIT
written=()
replay() {
  if ! DB_TEST_DIR=$replays node "$1" || [[ ! -s $replays/$(basename "$1" .mjs).sql ]]; then
    record "$1" migration 0 failed
    echo "$1 wrote no pgTAP file" >&2
    exit 1
  fi
  written+=("$1")
}
replay tests/hosted-default-privileges.mjs
replay tests/function-grants-migration.mjs
replay tests/agent-role-backfill.mjs
replay tests/bootstrap-db.mjs
replay tests/first-run-migration.mjs
replay tests/lead-agent-migration.mjs
replay tests/remove-agency-migration.mjs
replay tests/company-log-migration.mjs
replay tests/member-agent-visibility-migration.mjs
replay tests/agent-profile-moves-migration.mjs
replay tests/agent-key-waits-migration.mjs
stamped() {
  npx --no-install supabase test db "$replays" 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line"
    printf '%s %s\n' "$(date +%s%N)" "$line" >> "$session"
  done
}
status=0
started=$(date +%s%N)
step tests/db.sh 'migration replays' stamped || status=$?
# pg_prove's result lines in the order they came, each as "<file> <ms since the result before> <result>".
results=$(awk -v t="$started" '$2 ~ /\.sql$/ && $3 ~ /^\.+$/ { printf "%s %d %s\n", $2, ($1 - t) / 1000000, $4; t = $1 }' "$session")
for script in "${written[@]}"; do
  read -r _ ms outcome <<< "$(grep -F "$replays/$(basename "$script" .mjs).sql " <<< "$results" || true)"
  if [[ $outcome == ok ]]; then
    record "$script" migration "$ms" passed
  else
    record "$script" migration "${ms:-0}" failed
    echo "migration replay failed: $script" >&2
    status=1
  fi
done
exit "$status"
