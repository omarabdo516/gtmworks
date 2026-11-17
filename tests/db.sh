#!/usr/bin/env bash
set -euo pipefail
# With DB_LEDGER set (ci.sh database), each step appends one CI ledger line (#256); a failing step still ends the script
# with its own status, after its line is written.
step() {
  local file=$1 name=$2 started status=0
  shift 2
  started=$(date +%s%N)
  "$@" || status=$?
  if [[ -n ${DB_LEDGER:-} ]]; then
    printf '{"suite":"database","file":"%s","name":"%s","duration_ms":%d,"outcome":"%s","retries":0}\n' \
      "$file" "$name" $(( ($(date +%s%N) - started) / 1000000 )) "$( ((status == 0)) && echo passed || echo failed)" >> "$DB_LEDGER"
  fi
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
# seconds of start-up for milliseconds of SQL (#259). Each replay runs in its own rolled-back transaction, one after
# another, as before; side by side their schema changes would lock each other.
replays=$(mktemp -d)
trap 'rm -rf "$replays"' EXIT
replay() {
  DB_TEST_DIR=$replays node "$1"
  [[ -s $replays/$(basename "$1" .mjs).sql ]] || { echo "$1 wrote no pgTAP file" >&2; exit 1; }
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
step tests/db.sh 'migration replays' npx supabase test db "$replays"
