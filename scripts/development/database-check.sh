#!/usr/bin/env bash
# Upgrade test for database changes: build the schema that main has today, load existing data,
# apply only the migrations this change adds, then prove the data survived and the security
# invariants and integration tests still hold. Uses a throwaway local Supabase stack.
set -euo pipefail
cd "$(dirname "$0")/../.."

BASE="${BASE_SHA:?Set BASE_SHA to the commit this change will merge into}"
PROJECT="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)"
export NEXT_SITE_URL="${NEXT_SITE_URL:-http://127.0.0.1:3000}"
export NEXT_REDIRECT_URLS="${NEXT_REDIRECT_URLS:-http://127.0.0.1:3000/**}"
db() { docker exec -i "supabase_db_${PROJECT}" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

HOLD="$(mktemp -d)"
NEW=()
while IFS= read -r file; do [ -n "$file" ] && NEW+=("$file"); done < <(
  { git diff --name-only --diff-filter=A "$BASE" -- supabase/migrations; git ls-files --others --exclude-standard supabase/migrations; } | sort -u)

restore() { for file in "${NEW[@]:-}"; do [ -n "$file" ] && [ -f "$HOLD/$(basename "$file")" ] && mv "$HOLD/$(basename "$file")" "$file"; done; rm -rf "$HOLD"; }
trap restore EXIT

echo "::group::Baseline schema (main) with ${#NEW[@]} pending migration(s) held back"
for file in "${NEW[@]:-}"; do [ -n "$file" ] && mv "$file" "$HOLD/"; done
if supabase status >/dev/null 2>&1; then supabase db reset --local --no-seed
else supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,mailpit,postgres-meta,supavisor; fi
echo "::endgroup::"

echo "::group::Load existing data"
db < integration/seed-legacy.sql
echo "::endgroup::"

echo "::group::Apply this change's migrations"
for file in "${NEW[@]:-}"; do [ -n "$file" ] && mv "$HOLD/$(basename "$file")" "$file" && echo "pending: $file"; done
supabase migration up --local
echo "::endgroup::"

echo "::group::Existing data and security invariants"
db < integration/verify-legacy-data.sql
db < integration/schema-invariants.sql
echo "::endgroup::"

echo "::group::Integration tests"
eval "$(supabase status -o json | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(`export SUPABASE_URL=${s.API_URL} SUPABASE_ANON_KEY=${s.ANON_KEY} SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY}`)')"
node --test integration/*.test.mjs
echo "::endgroup::"
echo "Database upgrade check passed with ${#NEW[@]} new migration(s)."
