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
node tests/hosted-default-privileges.mjs
node tests/function-grants-migration.mjs
node tests/agent-role-backfill.mjs
node tests/bootstrap-db.mjs
node tests/first-run-migration.mjs
node tests/lead-agent-migration.mjs
node tests/remove-agency-migration.mjs
node tests/company-log-migration.mjs
