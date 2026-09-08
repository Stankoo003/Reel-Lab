# ReelLab

Expo (SDK 57) video capture and editing client, a Next.js API (deployable on Vercel's free tier), and a media pipeline.

```
app/          expo-router routes — the four top-level areas, plus editor, comments, profile
api/          typed API client (schema.d.ts, maintained by hand since the Next.js port)
src/          feed pager, editor state, theme, FFmpeg wrapper
server/       Next.js API + Postgres       (see server/README.md)
server-spring/ the previous Spring Boot API, kept as reference — not run
scripts/media/ encode + upload to R2       (see scripts/media/README.md)
```

## Quick start

```bash
npm install
npx patch-package && node scripts/patch-ffmpeg-fork.js   # lifecycle scripts are blocked here
cp .env.example .env                                     # then edit — see Configuration
npx expo prebuild
```

Then start the backend (`server/README.md`) and run on a device below.

## Configuration

Expo loads `.env`, `.env.local`, `.env.development` and `.env.production` automatically and
**inlines `EXPO_PUBLIC_*` at build time** — restart the bundler after changing them, and note
they are compiled into the bundle, so nothing secret may use that prefix.

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | ReelLab API |
| `EXPO_PUBLIC_MEDIA_BASE_URL` | media CDN; must match `MEDIA_CDN_BASE_URL` in `server/.env` |
| `EXPO_PUBLIC_APP_ENV` | shown on the Profile screen |

Templates: `.env.example`, `.env.production.example`. Real `.env*` files are gitignored.

## Signing in

Email and password. The token is kept in the device keychain (`expo-secure-store`), so a
session survives a restart, and every request carries it — the app no longer tells the server
who it is, it proves it.

The seeded development accounts are `aleksa@example.com` and `mila@example.com`, both with
the password **`lozinka123`** (see `server/db/seed/V900__seed_dev.sql`).

**`localhost` only resolves on the iOS simulator.** A physical device needs this machine's LAN
IP (currently `192.168.10.207`), or port forwarding on Android.

## Device setup — iOS

Signing is automated by `plugins/withSigning.js` (Apple team `VG7Z97CTBC`), so no team prompt.

```bash
xcrun devicectl list devices                 # find the UDID; tunnelState must not be "unavailable"
npx expo run:ios --device <UDID>
```

- The device must be **unlocked**, and stay unlocked during install — a locked phone fails with
  `Unable to launch … because the device was not, or could not be, unlocked`.
- First run needs the developer certificate trusted once:
  **Settings → General → VPN & Device Management → Apple Development → Trust**.
- A personal-team provisioning profile **expires after 7 days**. The app then refuses to launch
  until it is rebuilt. This is a limit of free Apple accounts, not a bug.
- ATS blocks cleartext HTTP by default. `NSAllowsLocalNetworking` is enabled, which covers
  private LAN addresses — an `http://` API on your LAN works, a public `http://` host will not.

## Device setup — Android

```bash
adb devices                                  # enable USB debugging on the phone first
npx expo run:android --device <serial>
adb reverse tcp:8081 tcp:8081                # Metro
adb reverse tcp:3000 tcp:3000                # API, if you prefer localhost to the LAN IP
```

With `adb reverse` in place you can leave `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`;
otherwise use the LAN IP. The emulator behaves the same way.

> **Not verified on a physical Android device.** Everything Android in this repo has been run on
> an emulator (Pixel 9a, API 36). The steps above are the standard ones but have not been
> exercised here.

## TestFlight

Two prerequisites, and neither is skippable. The API must be **deployed and reachable over
HTTPS** — iOS ATS refuses cleartext to a public host, so a build pointed at a LAN address is
an app that cannot reach its own backend. And the Apple account must be in the **paid
Developer Program**; a personal team can sign a build for your own phone and nothing else.

Server side: `server/README.md`. App side:

```bash
eas login
eas init                                          # writes extra.eas.projectId into app.json
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`eas.json` carries the production URLs in the profile's `env` block rather than in
`.env.production`. That is deliberate: `.env*` is gitignored, so a cloud build never receives
it, and a build that silently falls back to the development URL is the failure this avoids.

Before the first `submit`, the app must exist in App Store Connect — *My Apps → +* with the
bundle identifier `dev.reellab.spike`. `eas submit` can create it, but doing it by hand once
means the name and the SKU are yours rather than generated.

`usesNonExemptEncryption: false` in `app.json` answers the export-compliance question up
front. Without it every single build stops in App Store Connect and waits to be asked about
encryption, which it only uses through HTTPS.

Build numbers come from EAS, not the repo — `appVersionSource: "remote"` with
`autoIncrement`. `version` in `app.json` is still yours to bump when the release deserves it.

## Typed API client

`api/schema.d.ts` was generated from the Spring backend's `/v3/api-docs` and is now
**maintained by hand**: the Next.js server has no OpenAPI endpoint, and `npm run api:generate`
(`scripts/api/generate-client.sh`) only works against `server-spring/`. When an endpoint in
`server/app/api/` changes shape, edit the matching `paths` / `components.schemas` entry and run
`npm run typecheck` — a field the app reads that the server no longer sends fails there rather
than on a device.

The whole app is TypeScript — `tsconfig.json` typechecks `api/`, `app/` and `src/` under
`strict`, so `npm run typecheck` covers the screens as well as the generated client.

## Navigation

Four top-level tabs — **Feed**, **Create**, **My videos**, **Profile** — with the editor flow
(`editor → export → result`) pushed on top as a stack. Shared editor state lives in
`src/state/ClipsContext.tsx` because routes cannot share a `useState`.

**Profile** is where the backend health check runs; it is a typed call like any other, because
`springdoc.show-actuator` puts `/actuator/health` into the contract.

## The feed

Vertical pager, one clip per screen, cursor-paginated from `GET /api/videos/feed`.

**Players are pooled, not per row.** `src/feed/useVideoPool.ts` creates exactly three
`VideoPlayer`s and `replace()`s them as the active index moves — previous, current, next.
One player per row would hold one decoder per row, and a few dozen rows exhausts memory.
The neighbours are loaded but paused and muted, which is what preloads the next clip.

**One gesture is assigned: single tap**, which toggles play/pause. A double tap is
deliberately unhandled — `FeedItem` holds each tap for a 220 ms window and drops it if a
second arrives, so a double tap does nothing rather than toggling twice. That is the seam
a second gesture hooks into later. Long press opens the editor, on your own clips only.

### Audio policy, per platform

Set once in `app/_layout.tsx`, because an audio session is process-wide.

| | iOS | Android |
|---|---|---|
| Silent mode | **Plays anyway.** `playsInSilentMode: true` — the hardware Ring/Silent switch does not mute the feed. | **No-op.** Android has no silent switch governing media; media volume does, and the system honours it already. |
| Backgrounded | Audio stops (`shouldPlayInBackground: false`, matching `supportsBackgroundPlayback: false` for the `expo-video` plugin in `app.json` — the two must agree). | Same. |
| Other apps' audio | `interruptionMode: "doNotMix"` asks for exclusive focus, so starting the feed pauses music from another app rather than playing over it. | Same, as an `AUDIOFOCUS_GAIN` request. |

Playing through the silent switch is a deliberate choice, not an oversight: a viewer who
opened a video expects sound, and silence reads as a broken app. The escape hatch is the
per-feed **mute button**, which is why the feed ships with one.

**Interruptions** (a call, another app taking focus) are not something we are notified
about — `expo-audio` exposes no interruption event. Two things cover it instead. The pause
badge is driven by the player's own `playingChange`, so a clip the OS paused behind our
back is never shown as playing; and returning to the app flips the pool's `enabled` back
on, which re-asserts playback — unless the viewer had paused it, which is tracked
separately and deliberately survives.

## Music beds

The editor's AUDIO tab offers three bundled beds — **Pulse** (8 s), **Drift** (30 s) and
**Ticker** (20 s). `EditSettings.music` is the on/off toggle, `EditSettings.musicTrackId`
picks which one; both gains are in dB and both sliders run from −40 to 0.

**Where they come from.** They are synthesised from scratch by FFmpeg's own oscillators in
`scripts/media/make-audio.sh` — no sample, loop pack or recording from anyone else is
involved, so no third party holds rights in them. Re-running that script reproduces them.
They are released as **CC0 1.0 / public domain**; credit and licence live in
`scripts/media/ATTRIBUTION.md` and are surfaced in the app at the bottom of the AUDIO tab.
Downloading beds from the internet was deliberately avoided: provenance we cannot verify is
worse than a plain tone bed we can.

**Length mismatch — the rule.**

| Bed vs. the trimmed clip | What the export does |
|---|---|
| Bed **shorter** | It **loops** until the clip ends. `-stream_loop -1` on the music input, then `atrim` cuts at the clip length. |
| Bed **longer** | It is **trimmed** to the clip length. Same `atrim`; no fade-in on the source. |
| Either way | The last 0.6 s (or a quarter of the clip, whichever is smaller) fades out, so a loop seam or a trim point never cuts dead. |

The bed is never stretched or pitch-shifted to fit, and the video is never extended to match
the bed — the clip's length always wins. The AUDIO tab states which of the two will happen
per track, before you export.

**Mute is mute.** At −40 dB the original-audio slider does not attenuate — the `[0:a]`
branch is dropped from the filter graph entirely, because −40 dB is still audible on
headphones. With a bed selected the bed becomes the whole soundtrack; with no bed the output
is encoded `-an`, i.e. it carries no audio stream at all.

## Comments

Text only. One top-level comment **and** one reply per user, per video — enforced by
`comments_one_per_author_uq`, a `UNIQUE NULLS NOT DISTINCT (author_id, video_id, parent_id)`.
The `NULLS NOT DISTINCT` is the whole trick: `parent_id` is NULL for a top-level comment, and
a plain UNIQUE would let one user post unlimited roots while correctly limiting replies.

The service pre-checks so you get a clean 409 with a message telling you to edit instead; the
constraint is the guarantee, and a lost race is translated into the same 409 rather than a 500.
Editing is an update, so it never counts as a new comment.

The rule is stated **above the box**, before anything is typed — writing a comment and losing
it to a 409 is the failure that screen exists to prevent. Threads are cursor-paginated on the
roots, with replies nested one level and no further.

## Likes

One like per user per video (`video_likes_one_per_user_uq`). Unliking deletes the row; liking
again re-inserts. Both endpoints are **idempotent** — liking what you already liked succeeds
and changes nothing — which is what lets the optimistic UI retry, replay and race itself
without the count drifting. The insert uses `ON CONFLICT DO NOTHING`, so a concurrent like is
absorbed by the database rather than by a `catch`.

Double-tap on a feed clip toggles a like; the like button does the same thing for anyone who
cannot or would rather not use the gesture. Local clips get neither affordance.

## Profiles

Display name, avatar, bio and activity counts. Your own is editable, everyone else's is
read-only — and this is now enforced by the server, which takes the caller from the bearer
token and answers 403 for anyone else's profile.

**No endpoint returns an email, including your own profile and `/api/auth/me`.** The token
already proves who you are, so echoing the address back widens what a leaked response
exposes and buys nothing.

Avatar upload is the one exception to local-only media. It is validated **on the server**: an
allowlist of JPEG/PNG/WebP, checked against the file's actual magic bytes rather than the
Content-Type the client declares, and capped at 512KB separately from the 256MB media limit.

## Test

The Next.js server has no automated tests yet; `server/README.md` lists the curl checks that
were run against every endpoint. The Spring test suite still lives in `server-spring/` and
runs there with `./mvnw test` (Docker required).

## Posting a clip from the app

`Create → editor → Export → **Post**`. The Post screen takes a title, an optional
description and a publish toggle, then:

1. asks `POST /api/media?kind=video` where to put the exported video, and PUTs the bytes
   straight to the signed URL it answers with (R2 deployed, the API's own disk locally)
2. does the same for a poster generated from that same export (`kind=poster`)
3. creates the record with `POST /api/videos` using the returned **relative** paths
4. flips `published` if the toggle is on

The database still only ever holds relative paths; the CDN base is prepended by the
server, exactly as for seeded clips.

### Uploading files from React Native 0.86 — read this before changing it

`/api/media` is asked about **one file per request** with a `kind` parameter, and the bytes
are PUT with the native uploader (`UploadType.BINARY_CONTENT`). That looks odd until you try
the alternatives; both JS routes fail on this runtime:

| Approach | Result |
|---|---|
| `form.append("video", { uri, name, type })` | `Unsupported FormDataPart implementation` |
| `form.append("video", new File(uri).slice(...))` | `Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported` |
| `new File(uri).upload(url, { uploadType: BINARY_CONTENT, httpMethod: "PUT" })` | **works** |

The native uploader in `expo-file-system` is the only one that works, and it sends a
single file per call — so the endpoint is shaped around that rather than fighting it. The
server never receives the bytes itself: a Vercel function accepts ~4.5MB of body and a clip is
up to 256MB, which is why it signs an upload URL instead. Locally uploads land in
`MEDIA_STORAGE_DIR` (the repo's `media/`), served by the API at `/media/**`.
