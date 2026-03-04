#!/usr/bin/env bash
# One-time seed script: imports all entities from the contributors repo into the catalog API.
#
# Usage:
#   IMPORT_API_KEY=<key> API_URL=https://api.rulesentry.io ./scripts/import-all.sh
#
# Environment variables:
#   API_URL       - Catalog API base URL (default: http://localhost:8080)
#   IMPORT_API_KEY - Import API key (required)
#   GITHUB_RAW_BASE - Raw GitHub URL base (default: main branch of rulesentry/contributors)

set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"
GITHUB_RAW_BASE="${GITHUB_RAW_BASE:-https://raw.githubusercontent.com/rulesentry/contributors/main}"

if [ -z "${IMPORT_API_KEY:-}" ]; then
  echo "ERROR: IMPORT_API_KEY environment variable is required"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

imported=0
skipped=0
failed=0

import_file() {
  local file="$1"
  local rel_path="${file#$REPO_ROOT/}"
  local raw_url="${GITHUB_RAW_BASE}/${rel_path}"

  echo -n "  ${rel_path} ... "

  status=$(curl -s -o /tmp/import-response.json -w '%{http_code}' \
    -X POST "${API_URL}/api/v1/catalog/import-url" \
    -H "Content-Type: application/json" \
    -H "X-Import-Key: ${IMPORT_API_KEY}" \
    -d "{\"url\": \"${raw_url}\", \"catalog\": \"public\"}")

  if [ "$status" = "201" ]; then
    echo "imported"
    imported=$((imported + 1))
  elif [ "$status" = "409" ]; then
    echo "skipped (exists)"
    skipped=$((skipped + 1))
  else
    echo "FAILED (HTTP $status)"
    failed=$((failed + 1))
  fi
}

echo "Importing entities to ${API_URL}"
echo "Raw URL base: ${GITHUB_RAW_BASE}"
echo ""

# Import order: categories and profiles first (referenced by rules/policies),
# then regions, rules, and finally policies.
for entity_type in categories profiles regions rules policies; do
  entity_dir="${REPO_ROOT}/${entity_type}"
  if [ ! -d "$entity_dir" ]; then
    continue
  fi

  files=$(find "$entity_dir" -name '*.json' -not -path '*/examples/*' | sort)
  count=$(echo "$files" | grep -c '.' || true)

  if [ "$count" -gt 0 ]; then
    echo "--- ${entity_type} (${count} files) ---"
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      import_file "$file"
    done <<< "$files"
    echo ""
  fi
done

echo "Done: ${imported} imported, ${skipped} skipped, ${failed} failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
