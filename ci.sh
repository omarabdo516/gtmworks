#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-check}" in
 check)
  # Both stages in order, for local use. CI runs them as two parallel jobs (.github/workflows/ci.yml).
  bash ci.sh static
  bash ci.sh integration
  ;;
 static)
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
  fi
  node scripts/check-test-discovery.mjs
  python3 - <<'PY'
import html.parser, pathlib, sys

problems = []
class P(html.parser.HTMLParser):
    pass

for path in sorted(pathlib.Path("design").rglob("*.html")) if pathlib.Path("design").is_dir() else []:
    text = path.read_text(encoding="utf-8")
    try:
        P().feed(text)
    except Exception as exc:  # html.parser is lenient; anything raised is a real break
        problems.append(f"{path}: cannot be parsed ({exc})")
    head = text[:2000].lower()
    if 'dir="rtl"' not in head or 'lang="ar"' not in head:
        problems.append(f"{path}: the <html> tag must carry lang=\"ar\" dir=\"rtl\"")

for adr in sorted(pathlib.Path("docs/adr").glob("*.md")):
    first = adr.read_text(encoding="utf-8").splitlines()[:3]
    if not any(line.startswith("status:") for line in first):
        problems.append(f"{adr}: an ADR starts with a status line")

for p in problems:
    print(p)
print(f"ci.sh check: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
PY
  node scripts/check-i18n.mjs
  npx --yes @redocly/cli@2.76.0 lint docs/api/openapi.yaml --extends=spec
  npm run lint
  npm run typecheck
  npm test
  ;;
 integration)
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    npx playwright install --with-deps chromium
  fi
  bash scripts/local-db.sh
  if [[ "${CI:-}" == "true" ]]; then
    bash scripts/ci-image.sh
  fi
  for file in supabase/migrations/*.verify.sql scripts/check-rls.sql; do
    npx --no-install supabase db query --read-only --file "$file" -o json --agent no | node scripts/verify-db.mjs "$file"
  done
  npm run test:db
  # The production-shaped stack (proxy, https, public-looking host) runs on the database exactly as the seed builds it and
  # changes it (an enrolled authenticator, an invited member), so the seed is rebuilt before the main browser suite.
  npm run test:e2e:proxy
  bash scripts/local-db.sh
  npm run test:e2e
  ;;
 visual-update)
  # Rewrites only the approved screen images that changed. Run it where CI runs: the images are made for that system.
  if [[ "${CI:-}" == "true" ]]; then
    npm ci
    npx playwright install --with-deps chromium
  fi
  bash scripts/local-db.sh
  npm run test:visual:update
  ;;
 *) echo 'usage: ./ci.sh check | static | integration | visual-update' >&2; exit 2;;
esac
