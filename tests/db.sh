#!/usr/bin/env bash
set -euo pipefail
# The allowlist is the single source of truth for shared tables.
python3 - <<'PY'
from pathlib import Path
allowed = [x.strip() for x in Path('supabase/shared-tables.txt').read_text().splitlines() if x.strip() and not x.startswith('#')]
sql = Path('supabase/tests/foundation.sql').read_text()
expected = ','.join("'" + x.replace("'", "''") + "'" for x in allowed)
if f'c.relname not in ({expected})' not in sql:
    raise SystemExit('shared table allowlist and schema check disagree')
PY
npx supabase test db
# The migration replays write their pgTAP files here and run in one session: a `supabase test db` each cost about two
# seconds of start-up for milliseconds of SQL (#259). pg_prove runs the files in name order, not the order below; each
# rolls back its own transaction, so no replay sees another's changes. Side by side their schema changes would lock each
# other. Each replay is reported by name from pg_prove's line for its file.
replays=$(mktemp -d)
session=$(mktemp)
trap 'rm -rf "$replays" "$session"' EXIT
written=()
replay() {
  if ! DB_TEST_DIR=$replays node "$1" || [[ ! -s $replays/$(basename "$1" .mjs).sql ]]; then
    echo "$1 wrote no pgTAP file" >&2
    exit 1
  fi
  written+=("$1")
}
replay tests/hosted-default-privileges.mjs
replay tests/function-grants-migration.mjs
replay tests/bootstrap-db.mjs
replay tests/first-run-migration.mjs
replay tests/lead-agent-migration.mjs
replay tests/remove-agency-migration.mjs
replay tests/company-log-migration.mjs
replay tests/member-agent-visibility-migration.mjs
replay tests/agent-profile-moves-migration.mjs
replay tests/agent-key-waits-migration.mjs
replay tests/card-places-migration.mjs
replay tests/staged-cutover-migration.mjs
replay tests/agent-looks-migration.mjs
replay tests/agent-birth-migration.mjs
replay tests/role-agents-removal-migration.mjs
replay tests/install-owner-migration.mjs
status=0
npx --no-install supabase test db "$replays" 2>&1 | tee "$session" || status=$?
# pg_prove's result line for each file, as "<file> <result>".
results=$(awk '$1 ~ /\.sql$/ && $2 ~ /^\.+$/ { print $1, $3 }' "$session")
for script in "${written[@]}"; do
  read -r _ outcome <<< "$(grep -F "$replays/$(basename "$script" .mjs).sql " <<< "$results" || true)"
  if [[ $outcome != ok ]]; then
    echo "migration replay failed: $script" >&2
    status=1
  fi
done
exit "$status"
