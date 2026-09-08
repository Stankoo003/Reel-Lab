#!/usr/bin/env bash
# Publish the local API on its public HTTPS domain, for a TestFlight build.
#
# A TestFlight build has its API URL COMPILED IN — see api/config.ts. So the domain the
# tunnel answers on cannot be the random one a free tunnel hands out: it has to be the same
# string every time, or every restart means a new build. Hence a reserved ngrok domain
# rather than `ngrok http 3000`.
#
# The API has to be told the same domain twice over, because it hands out absolute URLs of
# its own: PUBLIC_BASE_URL is what a password-reset email links to, MEDIA_CDN_BASE_URL is
# what the app is told to load video from. Left at their local defaults, a phone on the
# internet gets links to a machine it cannot see.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env.tunnel ]]; then
  set -a; . ./.env.tunnel; set +a
fi

DOMAIN="${NGROK_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "NGROK_DOMAIN is not set." >&2
  echo >&2
  echo "  1. Reserve a domain at https://dashboard.ngrok.com/domains (free plan gives one)." >&2
  echo "  2. Put it in .env.tunnel:  NGROK_DOMAIN=your-name.ngrok-free.app" >&2
  exit 1
fi

BASE="https://$DOMAIN"
echo "→ publishing the API on $BASE"

# Refused rather than worked around. An API already on 8080 is one started with the LOCAL
# base URLs, and this script's own would fail to bind while the health check below passed
# against it — leaving the tunnel publishing a server that hands out localhost links, which
# looks like it works until a tester taps a reset email.
PORT="${PORT:-3000}"
if lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on $PORT. Stop it first:" >&2
  echo "  kill $(lsof -tiTCP:$PORT -sTCP:LISTEN | tr '\n' ' ')" >&2
  exit 1
fi

# Started first: the API takes a few seconds and the tunnel answering before it is up would
# hand a tester a 502 on their first launch.
echo "→ starting the API with the tunnel's own URLs"
(
  cd server
  # Exported AFTER .env is loaded, so the tunnel's URLs win over the local ones in the file.
  set -a; . ./.env; set +a
  export PUBLIC_BASE_URL="$BASE"
  export MEDIA_CDN_BASE_URL="$BASE/media"
  npx next dev -p "$PORT"
) &
API_PID=$!
# The tunnel is pointless without the thing behind it, and a bare `wait` would leave the
# tunnel running against a dead port if the API failed to boot.
trap 'kill $API_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/actuator/health" 2>/dev/null; then
    echo "→ API is up"
    break
  fi
  sleep 2
done

echo "→ opening the tunnel"
echo
echo "  Check that eas.json's production env matches:"
echo "    EXPO_PUBLIC_API_BASE_URL   = $BASE"
echo "    EXPO_PUBLIC_MEDIA_BASE_URL = $BASE/media"
echo
ngrok http "$PORT" --domain="$DOMAIN"
