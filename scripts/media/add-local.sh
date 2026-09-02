#!/usr/bin/env bash
# Add your own video files to the local library.
#
#   1. drop files into media/_incoming/
#   2. ./scripts/media/add-local.sh
#
# Each file is encoded to the SAME profile as encode.sh, given a poster, and
# registered with the API — so it shows up in the app like any other clip.
#
# Registration goes through POST /api/videos rather than the Flyway seed on purpose:
# editing an applied migration changes its checksum and forces a volume wipe. This
# way you can add clips as often as you like without resetting the database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IN="$ROOT/media/_incoming"
OUT="$ROOT/media"
API="${API_BASE_URL:-http://localhost:8080}"

# Same profile as encode.sh. Kept in sync by hand — if you change one, change both.
V_CODEC=(-c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p -crf 21 -preset slow)
V_SCALE="scale=1280:-2"
A_CODEC=(-c:a aac -b:a 128k -ar 48000 -ac 2)
MUX=(-movflags +faststart)
FPS_CAP=30
GOP_SECONDS=2

OWNER="${ACTING_USER_ID:-11111111-1111-4111-8111-111111111111}"
MAX_SECONDS="${MAX_SECONDS:-40}"   # keep clips short; set to 0 to keep full length

mkdir -p "$IN"
shopt -s nullglob nocaseglob
files=("$IN"/*.{mp4,mov,m4v,mkv,webm,avi})
shopt -u nullglob nocaseglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Nothing in $IN"
  echo "Drop some video files there and run this again."
  exit 0
fi

curl -sf --max-time 5 "$API/actuator/health" >/dev/null || {
  echo "API not reachable at $API — start the server first:" >&2
  echo "  cd server && SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run" >&2
  exit 1
}

for src in "${files[@]}"; do
  base="$(basename "${src%.*}")"
  # slugify: lowercase, non-alphanumerics to dashes
  name="$(echo "$base" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  [[ -n "$name" ]] || name="clip-$RANDOM"

  video="$OUT/videos/local/$name/clip.mp4"
  poster="$OUT/posters/local/$name.jpg"
  mkdir -p "$(dirname "$video")" "$(dirname "$poster")"

  src_dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$src")
  if [[ "$MAX_SECONDS" != "0" ]]; then
    dur=$(python3 -c "print(min($MAX_SECONDS, float('$src_dur')))")
  else
    dur="$src_dur"
  fi

  fps_raw=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate \
            -of default=nw=1:nk=1 "$src")
  fps=$(python3 -c "n,d='$fps_raw'.split('/'); print(min($FPS_CAP, max(1, round(int(n)/int(d)))))")
  gop=$(( fps * GOP_SECONDS ))

  echo "→ $name  (${dur%.*}s @ ${fps}fps)"
  ffmpeg -hide_banner -loglevel error -y \
    -t "$dur" -i "$src" \
    -vf "$V_SCALE" -r "$fps" \
    "${V_CODEC[@]}" -g "$gop" -keyint_min "$gop" -sc_threshold 0 \
    "${A_CODEC[@]}" "${MUX[@]}" "$video"

  # thumbnail= picks a representative frame instead of whatever sits at one offset;
  # a fixed timestamp eventually lands on a fade and a black poster looks like a
  # broken CDN.
  ffmpeg -hide_banner -loglevel error -y \
    -ss "$(python3 -c "print(min(3, float('$dur')/4))")" -i "$video" -frames:v 1 \
    -vf "thumbnail=n=$(( fps * 3 )),$V_SCALE" -q:v 4 "$poster"

  out_dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$video")
  title="$(echo "$base" | tr '_-' '  ')"

  # Paths sent to the API are RELATIVE. The database rejects a full URL, and the
  # CDN base is prepended by the server at response time.
  body=$(python3 -c "
import json
print(json.dumps({
  'ownerId': '$OWNER',
  'title': '''$title'''[:200],
  'description': 'Added locally with scripts/media/add-local.sh',
  'durationSeconds': max(1, round(float('$out_dur'))),
  'manifestPath': 'videos/local/$name/clip.mp4',
  'posterPath': 'posters/local/$name.jpg',
}))")

  id=$(curl -sf -X POST "$API/api/videos" -H 'Content-Type: application/json' -d "$body" \
       | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])") || {
    echo "   !! registration failed" >&2; continue; }

  # New videos start unpublished; publish so they appear in the Feed.
  curl -sf -X PATCH "$API/api/videos/$id" -H 'Content-Type: application/json' \
       -d '{"published":true}' >/dev/null
  echo "   registered $id, published"

  mv "$src" "$IN/.done-$(basename "$src")"
done

echo
echo "Done. Pull to refresh in the app."
echo "Originals moved aside as .done-* in $IN — delete them when you are happy."
