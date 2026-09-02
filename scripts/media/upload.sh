#!/usr/bin/env bash
# Upload the encoded media to Cloudflare R2, with correct content types, then
# apply the CORS policy and verify over HTTPS.
#
# Idempotent: re-running overwrites the same keys.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MEDIA="$ROOT/media"

[[ -f "$HERE/.env.r2" ]] || { echo "missing $HERE/.env.r2 — copy .env.r2.example" >&2; exit 1; }
set -a; . "$HERE/.env.r2"; set +a

for v in R2_ACCOUNT_ID R2_BUCKET R2_PUBLIC_BASE_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  [[ -n "${!v:-}" ]] || { echo "$v is not set in .env.r2" >&2; exit 1; }
done

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto

# AWS CLI >= 2.23 attaches CRC32 integrity headers by default; R2 has historically
# rejected them ("Header 'x-amz-checksum-crc32' not implemented"). Restoring the
# previous behaviour costs nothing and is harmless if R2 now accepts them.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

aws_r2() { aws --endpoint-url "$ENDPOINT" "$@"; }

content_type_for() {
  case "$1" in
    *.mp4) echo "video/mp4" ;;
    *.jpg|*.jpeg) echo "image/jpeg" ;;
    *.m3u8) echo "application/vnd.apple.mpegurl" ;;
    *.ts)  echo "video/mp2t" ;;
    *) echo "application/octet-stream" ;;
  esac
}

# Every object gets an explicit --content-type. `aws s3 sync` guesses from the
# extension, and a wrong Content-Type on an MP4 is precisely the failure this is
# meant to prevent — it is also invisible until a browser refuses to play.
echo "→ uploading to s3://$R2_BUCKET via $ENDPOINT"
count=0
while IFS= read -r -d '' file; do
  key="${file#"$MEDIA"/}"
  [[ "$key" == _src/* ]] && continue          # keep source downloads local
  ct="$(content_type_for "$file")"
  printf '   %-46s %s\n' "$key" "$ct"
  aws_r2 s3api put-object \
    --bucket "$R2_BUCKET" \
    --key "$key" \
    --body "$file" \
    --content-type "$ct" \
    --cache-control "public, max-age=31536000, immutable" \
    >/dev/null
  count=$((count + 1))
done < <(find "$MEDIA" -type f \( -name '*.mp4' -o -name '*.jpg' \) -print0)
echo "   $count objects uploaded"

# R2 ignores ACLs entirely — public access comes from the bucket's r2.dev setting,
# not from --acl public-read. CORS, however, is a real S3 API call.
echo "→ applying CORS"
aws_r2 s3api put-bucket-cors --bucket "$R2_BUCKET" \
  --cors-configuration "file://$HERE/cors.json"

echo "→ verifying over HTTPS"
fail=0
while IFS= read -r -d '' file; do
  key="${file#"$MEDIA"/}"
  [[ "$key" == _src/* ]] && continue
  url="${R2_PUBLIC_BASE_URL%/}/$key"
  read -r code ctype < <(curl -sIL --max-time 20 "$url" \
      -o /dev/null -w '%{http_code} %{content_type}\n')
  expected="$(content_type_for "$file")"
  if [[ "$code" == "200" && "$ctype" == "$expected"* ]]; then
    printf '   ✓ %-46s %s %s\n' "$key" "$code" "$ctype"
  else
    printf '   ✗ %-46s %s %s (expected %s)\n' "$key" "$code" "$ctype" "$expected"
    fail=1
  fi
done < <(find "$MEDIA" -type f \( -name '*.mp4' -o -name '*.jpg' \) -print0)

# Range support is what makes scrubbing work; a 200 here instead of 206 means
# seeking will re-download from the start.
probe="$(find "$MEDIA" -name '*.mp4' | head -1)"
probe_key="${probe#"$MEDIA"/}"
range_code=$(curl -sI --max-time 20 -H 'Range: bytes=0-99' \
  "${R2_PUBLIC_BASE_URL%/}/$probe_key" -o /dev/null -w '%{http_code}')
[[ "$range_code" == "206" ]] \
  && echo "   ✓ range requests: 206" \
  || { echo "   ✗ range requests returned $range_code (expected 206)"; fail=1; }

[[ $fail -eq 0 ]] || { echo "verification FAILED" >&2; exit 1; }
echo
echo "Done. Set on both sides:"
echo "  server/.env      MEDIA_CDN_BASE_URL=${R2_PUBLIC_BASE_URL%/}"
echo "  .env (root)      EXPO_PUBLIC_MEDIA_BASE_URL=${R2_PUBLIC_BASE_URL%/}"
