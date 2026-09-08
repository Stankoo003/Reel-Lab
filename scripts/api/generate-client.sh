#!/usr/bin/env bash
# Regenerate the typed API client from the backend's own OpenAPI contract.
#
# ONLY the legacy Spring backend (server-spring/) publishes /v3/api-docs. The Next.js server in
# server/ does not, so api/schema.d.ts is maintained by hand now — see README "Typed API client".
# This script is kept for regenerating against server-spring/ when comparing the two.
#
# api/schema.d.ts is GENERATED and committed, so a fresh clone typechecks without a
# running backend. Re-run this whenever a controller or DTO changes on the server —
# if the two drift, `npx tsc --noEmit` fails instead of the app failing on a device.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${API_BASE_URL:-http://localhost:8080}"
SPEC_URL="$BASE/v3/api-docs"
OUT="$ROOT/api/schema.d.ts"

echo "→ fetching contract from $SPEC_URL"
if ! curl -sf --max-time 15 "$SPEC_URL" -o "$ROOT/api/openapi.json"; then
  echo "could not reach $SPEC_URL — start the server first:" >&2
  echo "  cd server-spring && SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run" >&2
  exit 1
fi

paths=$(python3 -c "import json;print(len(json.load(open('$ROOT/api/openapi.json'))['paths']))")
echo "   $paths paths"

echo "→ generating $OUT"
npx --yes openapi-typescript "$ROOT/api/openapi.json" -o "$OUT"

# The contract snapshot itself is not committed; only the generated types are.
rm -f "$ROOT/api/openapi.json"
echo "→ typechecking"
npx tsc --noEmit
echo "Done."
