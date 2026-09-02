#!/usr/bin/env bash
# Encode the seeded clips to one consistent web/mobile profile.
#
# Sources are Blender open-movie trailers (CC-BY 3.0) — see ATTRIBUTION.md.
# Deliberately the trailers, not the full films: a 700 MB download for a 30 s cut is waste.
#
# Output lands in media/ (gitignored). Re-running is safe and skips re-downloading.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/media/_src"
OUT="$ROOT/media"
mkdir -p "$SRC" "$OUT/videos/blender" "$OUT/posters/blender"

# ---------------------------------------------------------------------------
# The profile. One place, applied to every clip — that is what makes it a profile
# rather than a pile of ad-hoc ffmpeg invocations.
# ---------------------------------------------------------------------------
#   yuv420p is not optional: 4:2:2/4:4:4 output plays fine on a desktop and fails
#   silently on phones.
#   -2 in scale keeps the height even, which H.264 requires.
#   +faststart moves the moov atom to the front, or progressive HTTP playback
#   stalls until the whole file has landed.
V_CODEC=(-c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p -crf 21 -preset slow)
V_SCALE="scale=1280:-2"
A_CODEC=(-c:a aac -b:a 128k -ar 48000 -ac 2)
MUX=(-movflags +faststart)
FPS_CAP=30
GOP_SECONDS=2

# name | url | start | duration | poster timestamp (relative to the cut)
CLIPS=(
  "big-buck-bunny|https://download.blender.org/peach/trailer/trailer_1080p.mov|1|30|6"
  "sintel|https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4|10|30|14"
)

for spec in "${CLIPS[@]}"; do
  IFS='|' read -r name url start dur poster_at <<<"$spec"
  src="$SRC/$name.${url##*.}"

  if [[ ! -f "$src" ]]; then
    echo "→ downloading $name"
    curl -fL --progress-bar "$url" -o "$src"
  else
    echo "→ $name source cached"
  fi

  # Source frame rate, capped. Both current sources are <= 25 fps so nothing is
  # resampled; forcing 30 on 24 fps buys nothing and adds judder.
  fps_raw=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate \
            -of default=nw=1:nk=1 "$src")
  fps=$(python3 -c "n,d='$fps_raw'.split('/'); print(min($FPS_CAP, round(int(n)/int(d))))")
  gop=$(( fps * GOP_SECONDS ))

  video="$OUT/videos/blender/$name/clip.mp4"
  poster="$OUT/posters/blender/$name.jpg"
  mkdir -p "$(dirname "$video")"

  echo "→ encoding $name  (${dur}s @ ${fps}fps, GOP ${gop})"
  ffmpeg -hide_banner -loglevel error -y \
    -ss "$start" -t "$dur" -i "$src" \
    -vf "$V_SCALE" -r "$fps" \
    "${V_CODEC[@]}" -g "$gop" -keyint_min "$gop" -sc_threshold 0 \
    "${A_CODEC[@]}" "${MUX[@]}" \
    "$video"

  # thumbnail= picks the most representative frame from the window rather than
  # whatever happens to sit at one timestamp. A fixed offset lands on a fade-to-black
  # sooner or later, and a black poster looks like a broken CDN.
  echo "→ poster  $name"
  ffmpeg -hide_banner -loglevel error -y \
    -ss "$poster_at" -i "$video" -frames:v 1 \
    -vf "thumbnail=n=$(( fps * 3 )),$V_SCALE" -q:v 4 "$poster"

  # A poster that is essentially black means the window was wrong; fail loudly
  # instead of shipping it.
  lum=$(ffprobe -v error -f lavfi -i "movie='$poster',signalstats" \
        -show_entries frame_tags=lavfi.signalstats.YAVG -of default=nw=1:nk=1 | head -1)
  if python3 -c "import sys; sys.exit(0 if float('$lum') < 20 else 1)"; then
    echo "   !! poster for $name is near-black (YAVG=$lum) — adjust its poster offset" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Show what was actually produced. The profile should be visible, not assumed.
# ---------------------------------------------------------------------------
echo
printf '%-22s %-9s %-6s %-11s %-8s %-7s %-9s %s\n' \
       CLIP CODEC PROF SIZE PIXFMT FPS DURATION BYTES
for spec in "${CLIPS[@]}"; do
  name="${spec%%|*}"
  f="$OUT/videos/blender/$name/clip.mp4"
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,profile,width,height,pix_fmt,avg_frame_rate \
    -show_entries format=duration,size -of default=nw=1:nk=1 "$f" \
  | python3 -c "
import sys
v=[l.strip() for l in sys.stdin if l.strip()]
codec,prof,w,h,pix,rate,dur,size=v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7]
n,d=rate.split('/'); fps=round(int(n)/int(d),2)
print(f'{\"$name\":<22} {codec:<9} {prof:<6} {w+\"x\"+h:<11} {pix:<8} {fps:<7} {float(dur):<9.2f} {int(size)/1e6:.1f}MB')
"
done
echo
echo "Encoded into $OUT (gitignored). Next: scripts/media/upload.sh"
