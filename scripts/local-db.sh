#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/supabase/migrations"
cp scripts/local-default-privileges.sql "$tmp_dir/supabase/migrations/00000000000000_local_default_privileges.sql"
cp supabase/seed.sql supabase/config.toml "$tmp_dir/supabase/"
for f in supabase/migrations/*.sql; do
  [[ $f == *.verify.sql ]] || cp "$f" "$tmp_dir/supabase/migrations/"
done
npx --no-install supabase start --workdir "$tmp_dir"
npx --no-install supabase db reset --workdir "$tmp_dir"
