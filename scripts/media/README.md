# Media pipeline

Encode the seeded clips to one consistent profile, upload once to Cloudflare R2 with correct
content types and CORS, and serve them to both the app and the API.

Encoded output lives in `media/` at the repo root and is **gitignored** — it is regenerable
from `encode.sh`, so it does not belong in git. The scripts and these steps are committed.

## 1. Encode (no credentials needed)

```bash
./scripts/media/encode.sh
```

Downloads two Blender open-movie trailers to `media/_src/` (cached across runs), cuts 30 s from
each, and encodes through a single profile:

| | |
|---|---|
| container | MP4, `+faststart` |
| video | H.264 High @ 4.0, `yuv420p`, 1280×720, CRF 21, `preset slow` |
| frame rate | source rate, capped at 30 |
| keyframes | every 2 s, scene-cut detection off |
| audio | AAC-LC 128 kbps, 48 kHz, stereo |
| poster | JPEG 1280×720, `-q:v 4` |

Three of those are load-bearing rather than taste:

- **`yuv420p`** — 4:2:2/4:4:4 output plays on a desktop and fails silently on phones.
- **`+faststart`** — puts the `moov` atom before `mdat`. Without it, progressive HTTP playback
  stalls until the entire file has downloaded.
- **`scale=1280:-2`** — the `-2` keeps the height even, which H.264 requires.

Posters are chosen with ffmpeg's `thumbnail` filter over a window instead of a fixed timestamp,
and the script **fails** if the result is near-black. A fixed offset eventually lands on a
fade, and a black poster is indistinguishable from a broken CDN.

The script prints an `ffprobe` summary of every output, so the profile is visible rather than
assumed.

## 2. Create the bucket (once)

1. Cloudflare dashboard → **R2** → *Create bucket*, e.g. `reellab-media`.
2. Open the bucket → **Settings** → *Public Development URL* → **Enable**.
   This gives a `https://pub-<hash>.r2.dev` address.
   R2 **ignores S3 ACLs entirely** — passing `--acl public-read` does nothing. Public access
   comes from this setting alone.
   `r2.dev` is rate-limited and Cloudflare does not recommend it for production; attach a
   custom domain when that matters.
3. **R2 → API → Create API token**, scoped to *Object Read & Write* on this bucket. Copy the
   Access Key ID and Secret Access Key — the secret is shown once.
4. The bucket page shows the **S3 API endpoint**; the hex string in it is your account id.

```bash
cp scripts/media/.env.r2.example scripts/media/.env.r2   # gitignored
$EDITOR scripts/media/.env.r2
```

## 3. Upload

```bash
./scripts/media/upload.sh
```

It uploads each object with an **explicit `--content-type`** (`video/mp4`, `image/jpeg`), sets
a long `Cache-Control`, applies `cors.json`, then verifies every object over HTTPS with a HEAD
request and checks that a `Range` request returns `206`.

Deliberately **not** `aws s3 sync`: sync guesses the content type from the extension, and a
wrong `Content-Type` on an MP4 is exactly the failure this task exists to prevent — invisible
until a browser refuses to play.

The script exports `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`. AWS CLI ≥ 2.23 attaches
CRC32 integrity headers by default and R2 has historically rejected them
(`Header 'x-amz-checksum-crc32' not implemented`). Harmless if R2 now accepts them.

### CORS

`cors.json` allows `GET`/`HEAD` from any origin and — the part that matters — **exposes**
`Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Type` and `ETag`. Without the
range headers exposed, seeking breaks on web while looking fine on native, because native
players are not subject to CORS at all.

## 4. Point both sides at the CDN

The URL is configuration on both sides; neither stores it.

```bash
# server/.env
MEDIA_CDN_BASE_URL=https://pub-<hash>.r2.dev

# .env at the repo root (client)
EXPO_PUBLIC_MEDIA_BASE_URL=https://pub-<hash>.r2.dev
EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8080
```

The database keeps **relative paths only** (`videos/blender/sintel/clip.mp4`); the server
composes absolute URLs in `MediaUrlAssembler`, and a `CHECK` constraint rejects any attempt to
store a full URL. Moving CDN is a config change, not a data migration.

## 5. Regenerating

```bash
./scripts/media/encode.sh && ./scripts/media/upload.sh
```

Both are idempotent. To change the clips or the cut points, edit the `CLIPS` array at the top
of `encode.sh` — and update `server/src/main/resources/db/seed/V900__seed_dev.sql` to match.

Editing that seed changes an already-applied migration's checksum, so Flyway will refuse to
start against an existing dev volume. Reset it:

```bash
cd server && docker compose down -v && docker compose up -d
```

## Licensing

Source clips are Blender Foundation open movies under **CC-BY 3.0**. Attribution is a licence
condition — see [ATTRIBUTION.md](ATTRIBUTION.md).

## Known platform difference

`generateThumbnailsAsync` (the editor filmstrip) produces frames from a **remote** URL on
Android but not on iOS — verified against a range-capable HTTP host. Playback itself works on
both. Local clips are unaffected: the iOS filmstrip works for recorded and imported files.

If the filmstrip is needed for library clips on iOS, the fix is to materialise the clip first
(`materialiseForExport` in `spike/library.ts` already does exactly that for export) and point
the player at the local copy.

## Why range support is not optional

AVPlayer on iOS refuses a progressive MP4 whose host answers a `Range` request with `200`
instead of `206` — the video silently fails to load, with a prohibited-sign PLAY button.
ExoPlayer on Android tolerates it and falls back to a full download, so **this failure is
invisible if you only test Android**. R2 supports ranges; `upload.sh` asserts a `206` so a
misconfigured host is caught at upload time rather than by a user.
