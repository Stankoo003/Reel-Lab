#!/usr/bin/env bash
# Point the app and the API at this machine's current LAN IP.
#
# The one thing that breaks the app every time you change network: EXPO_PUBLIC_* values are
# INLINED INTO THE BUNDLE when Metro bundles, not read at runtime. So a stale IP survives an
# app restart, a Metro restart, everything — until the JS is bundled again. Hence --clear
# on the Metro line below.
#
# The API hands out absolute media URLs of its own (MEDIA_CDN_BASE_URL) and reset links
# (PUBLIC_BASE_URL), so server/.env is pointed at the same host — a phone cannot open
# localhost on this Mac.
set -euo pipefail
cd "$(dirname "$0")"

IP=$(ipconfig getifaddr en1 2>/dev/null || ipconfig getifaddr en0)
[[ -n "$IP" ]] || { echo "No LAN IP — are you on a network?" >&2; exit 1; }
PORT="${PORT:-3000}"

[[ -f .env ]] || cp .env.example .env
[[ -f server/.env ]] || { echo "server/.env is missing — copy server/.env.example and fill it in first." >&2; exit 1; }

sed -i '' \
  "s|^EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=http://$IP:$PORT|; \
   s|^EXPO_PUBLIC_MEDIA_BASE_URL=.*|EXPO_PUBLIC_MEDIA_BASE_URL=http://$IP:$PORT/media|" .env
sed -i '' \
  "s|^MEDIA_CDN_BASE_URL=.*|MEDIA_CDN_BASE_URL=http://$IP:$PORT/media|; \
   s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://$IP:$PORT|" server/.env
echo "→ pointed app and API at http://$IP:$PORT"
echo
echo "Now run these, one per terminal tab:"
echo
echo "  1. DB + mail  cd server && docker compose up -d      (Postgres :5433, Mailpit :8025 — once)"
echo "                cd server && npm run migrate            (after a fresh DB add: -- --seed)"
echo "  2. API        cd server && npx next dev -p $PORT"
echo "  3. App        npx expo start --dev-client --clear"
echo
echo "Health check:  curl http://$IP:$PORT/actuator/health"
