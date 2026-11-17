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
# other. Each replay gets a ledger line with its own outcome, read from pg_prove's line for its file.
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
status=0
step tests/db.sh 'migration replays' bash -c 'set -o pipefail; npx supabase test db "$1" 2>&1 | tee "$2"' _ "$replays" "$session" || status=$?
for script in "${written[@]}"; do
  if grep -qE "/$(basename "$script" .mjs)\.sql \.+ ok$" "$session"; then
    record "$script" migration 0 passed
  else
    record "$script" migration 0 failed
    echo "migration replay failed: $script" >&2
    status=1
  fi
done
exit "$status"
