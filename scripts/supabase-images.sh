#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The Supabase images a stack runs, kept as one archive in the Actions cache on GitHub-hosted runners (#259): with a warm
# cache the stack starts without a registry call, so the registry's rate limit cannot fail the job (no retried pulls, D15
# in #255). SUPABASE_IMAGES_ARCHIVE names the archive; without it (the PC, a laptop) load and save do nothing.
#   key            the cache key: the Supabase CLI's version and the configuration lines that choose images (each
#                  section, its enabled line and the Postgres version; a port or an auth setting keeps the key)
#   load           load the archive, when there is one
#   list           the Supabase images on this machine
#   pulled BEFORE  how many images the registry served since BEFORE (a file `list` wrote)
#   save           write every Supabase image on this machine into the archive
archive=${SUPABASE_IMAGES_ARCHIVE:-}
list() { docker images --format '{{.Repository}}:{{.Tag}}' | grep '^public\.ecr\.aws/supabase/' | sort || true; }
case ${1:-} in
 key)
  printf 'supabase-images-%s-%s\n' "$(node -p "require('./package-lock.json').packages['node_modules/supabase'].version")" \
    "$(grep -E '^(\[|enabled = |major_version = )' supabase/config.toml | sha256sum | cut -c1-16)"
  ;;
 load)
  if [[ -n $archive && -s $archive ]]; then
    docker load -q -i "$archive"
  else
    echo 'supabase images: no cached archive'
  fi
  ;;
 list) list ;;
 pulled)
  mapfile -t pulled < <(comm -13 "$2" <(list))
  echo "supabase images: ${#pulled[@]} pulled from the registry${pulled[*]:+: ${pulled[*]}}"
  ;;
 save)
  [[ -n $archive ]] || { echo 'SUPABASE_IMAGES_ARCHIVE is not set' >&2; exit 2; }
  mapfile -t images < <(list)
  ((${#images[@]})) || { echo 'supabase images: none to save' >&2; exit 1; }
  mkdir -p "$(dirname "$archive")"
  docker save -o "$archive" "${images[@]}"
  echo "supabase images: saved ${#images[@]} ($(du -h "$archive" | cut -f1)): ${images[*]}"
  ;;
 *) echo 'usage: scripts/supabase-images.sh key | load | list | pulled BEFORE | save' >&2; exit 2 ;;
esac
