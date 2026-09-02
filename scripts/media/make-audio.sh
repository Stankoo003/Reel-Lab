#!/usr/bin/env bash
# Regenerates the bundled music beds in assets/spike/audio/.
#
# Every track here is SYNTHESISED from scratch by FFmpeg's own oscillators — no sample,
# loop pack or recording from a third party is involved, so the output carries no
# third-party rights at all. That is the whole reason the beds are made this way rather
# than downloaded: the provenance is verifiable by re-running this script.
#
# The tracks are deliberately different lengths so the export path's loop/trim behaviour
# is exercisable with real files (see src/export.ts, "length mismatch").
#
# Usage: ./scripts/media/make-audio.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
OUT=assets/spike/audio
mkdir -p "$OUT"

enc=(-c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart)

# --- pulse.m4a — 8s, deliberately SHORTER than a typical clip, to exercise looping.
# A 110 Hz root plus its fifth, re-struck every half second with an exponential decay.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc='0.42*exp(-7*mod(t,0.5))*(sin(2*PI*110*t)+0.5*sin(2*PI*165*t))':s=44100:d=8" \
  -af "afade=t=in:d=0.05,alimiter=limit=0.9" "${enc[@]}" "$OUT/pulse.m4a"

# --- drift.m4a — 30s pad, LONGER than most clips, to exercise trimming.
# An A-major triad of sines under a slow 0.15 Hz tremolo.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc='0.3*(0.6+0.4*sin(2*PI*0.15*t))*(sin(2*PI*220*t)+0.7*sin(2*PI*277.18*t)+0.5*sin(2*PI*329.63*t))/2.2':s=44100:d=30" \
  -af "afade=t=in:d=1.5,afade=t=out:st=28.5:d=1.5,alimiter=limit=0.9" "${enc[@]}" "$OUT/drift.m4a"

# --- ticker.m4a — 20s, a four-note arpeggio clocked at 4 notes per second.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc='0.4*exp(-11*mod(t,0.25))*sin(2*PI*440*pow(1.0594630943592953,3*mod(floor(t*4),4))*t)':s=44100:d=20" \
  -af "afade=t=in:d=0.05,afade=t=out:st=19.4:d=0.6,alimiter=limit=0.9" "${enc[@]}" "$OUT/ticker.m4a"

for f in "$OUT"/pulse.m4a "$OUT"/drift.m4a "$OUT"/ticker.m4a; do
  printf '%s\t%s s\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
done
