#!/usr/bin/env bash
set -euo pipefail
# With DB_LEDGER set (ci.sh database), each step appends one CI ledger line (#256); a failing step still ends the script
# with its own status, after its line is written.
step() {
  local started status=0 file=supabase/tests name=pgTAP
  [[ $1 == node ]] && file=$2 name=migration
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
step npx supabase test db
step node tests/hosted-default-privileges.mjs
step node tests/function-grants-migration.mjs
step node tests/agent-role-backfill.mjs
step node tests/bootstrap-db.mjs
step node tests/first-run-migration.mjs
step node tests/lead-agent-migration.mjs
step node tests/remove-agency-migration.mjs
step node tests/company-log-migration.mjs
step node tests/member-agent-visibility-migration.mjs
step node tests/agent-profile-moves-migration.mjs
step node tests/agent-key-waits-migration.mjs
