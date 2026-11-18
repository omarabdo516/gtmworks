#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# LANE=n (n > 0) builds another whole local stack for browser test lane n (tests/lane.mjs, #69): its own project, every
# Supabase port moved by 100*n, the app origin on port 3000+n, kept in supabase/.temp/lanes/n for the tests to reach.
# Every lane starts the services supabase/config.toml enables, lane 0 included (#259).
# `--config-only DIR` writes the lane's project into DIR and starts nothing (tests/lane-services.test.mjs reads it).
lane=${LANE:-0}
[[ $lane =~ ^[0-6]$ ]] || { echo 'LANE must be 0 to 6' >&2; exit 2; }
config_only=false
if [[ ${1:-} == --config-only ]]; then
  [[ -d ${2:-} ]] || { echo 'usage: scripts/local-db.sh --config-only DIR' >&2; exit 2; }
  config_only=true
  tmp_dir=$2
elif [[ $lane == 0 ]]; then
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT
else
  tmp_dir="$PWD/supabase/.temp/lanes/$lane"
  rm -rf "$tmp_dir"
fi
mkdir -p "$tmp_dir/supabase/migrations"
cp scripts/local-default-privileges.sql "$tmp_dir/supabase/migrations/00000000000000_local_default_privileges.sql"
cp supabase/seed.sql supabase/config.toml "$tmp_dir/supabase/"
for f in supabase/migrations/*.sql; do
  [[ $f == *.verify.sql ]] || cp "$f" "$tmp_dir/supabase/migrations/"
done
if [[ $lane != 0 ]]; then
  config="$tmp_dir/supabase/config.toml"
  # Every port moves from lane 0's.
  awk -v by=$((100 * lane)) '/^(port|shadow_port) = [0-9]+$/ { $3 += by } 1' "$config" > "$config.tmp"
  mv "$config.tmp" "$config"
  sed -i -e "s/^project_id = .*/project_id = \"repo-lane-$lane\"/" \
    -e "s/^inspector_port = 8083$/inspector_port = $((8083 + lane))/" -e "s#\(127\.0\.0\.1\|localhost\):3000\b#\1:$((3000 + lane))#g" \
    "$config"
fi
[[ $config_only == false ]] || exit 0
# A first start applies the migrations and the seed itself; a stack whose database already exists is rebuilt.
project=$(sed -n 's/^project_id = "\(.*\)"$/\1/p' "$tmp_dir/supabase/config.toml")
existing=false
if docker volume inspect "supabase_db_$project" > /dev/null 2>&1; then existing=true; fi
npx --no-install supabase start --workdir "$tmp_dir"
if [[ $existing == true ]]; then npx --no-install supabase db reset --workdir "$tmp_dir"; fi
# The seeded data as one script that puts it back: browser spec files start from it (tests/fresh-seed.ts, #69), so no
# file sees what an earlier one left. Migration records and the realtime service's own tables are not data and stay.
snapshot="$PWD/supabase/.temp/lanes/$lane/seed-data.sql"
mkdir -p "$(dirname "$snapshot")"
# The database container this lane started, for scripts that reach it (ci.sh database).
echo "supabase_db_$project" > "$PWD/supabase/.temp/lanes/$lane/db-container"
{
  cat <<'SQL'
set session_replication_role = replica;
do $$ begin
  execute (select 'truncate ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' restart identity cascade'
    from pg_tables where schemaname in ('public', 'auth', 'storage', 'vault')
      and (schemaname, tablename) not in (('auth', 'schema_migrations'), ('storage', 'migrations')));
end $$;
SQL
  docker exec "supabase_db_$project" pg_dump -U supabase_admin -d postgres --data-only --disable-triggers \
    --schema=public --schema=auth --schema=storage --schema=vault \
    --exclude-table=auth.schema_migrations --exclude-table=storage.migrations
} > "$snapshot.tmp"
mv "$snapshot.tmp" "$snapshot"
