# ReelLab video-editing spike — findings

**Date:** 2026-08-27 · **Stack:** Expo SDK 57.0.17, RN 0.86.3, React 19.2.3, New Architecture (bridgeless)
**Engine:** FFmpegKit community fork · **Licence:** GPL acceptable (open-source project)

> **Historical record.** This documents the spike as it stood on 2026-08-27. The measurements
> and the verdict still hold; the app around them does not. The probes harness and its tab are
> gone, several files named below no longer exist, and the directory the spike lived in is now
> `src/` and holds shipped code — the feed pager, the video pool, the theme, comments and
> profiles. See `README.md` for the app as it is. Sections 6a and 7 are the most out of date.

---

## 1. Verdict per capability

| # | Capability | iOS | Android | Evidence |
|---|---|---|---|---|
| 1a | Record a clip with the camera | ⚠️ **not executed** | ⚠️ **not executed** | `expo-camera` `CameraView mode="video"` + `recordAsync()` wired in `RecordScreen.js` (removed; the camera now lives in `src/screens/CameraScreen.tsx`); no real camera on simulator/emulator |
| 1b | Get a clip from the gallery | ⚠️ module only | ✅ **end-to-end** | `expo-image-picker`; on Android the picker was driven for real and the picked clip fed every probe (§2a) |
| 2 | Extract frames at intervals | ✅ | ✅ | ffmpeg `fps=1` 253 ms / 651 ms; `expo-video` 147 ms / 447 ms per frame; `expo-video-thumbnails` 405 ms / 53 ms per frame |
| 3 | Trim to a sub-range | ✅ | ✅ | stream-copy 48 ms / 35 ms; re-encode 1245 ms / 1005 ms |
| 4 | Burn a text overlay | ✅ | ✅ | `drawtext` + `libfreetype`; overlay visually confirmed in an extracted frame. Text is runtime-selectable from the UI, incl. `:`/`%`/diacritics |
| 5 | Mix in an audio track | ✅ | ✅ | `amix`; 440/660 Hz music bands rise ~10 dB while the source 220 Hz tone stays at −21.1 dB |
| ★ | **trim + text + audio in ONE pass** | ✅ | ✅ | see §2 |

Because neither simulator nor emulator can record video, `RecordScreen.js` (removed; the camera now lives in `src/screens/CameraScreen.tsx`)
also offers **Pick from gallery** (`expo-image-picker`). That is the only way to get a real clip
into the probes on the iOS simulator, and it is how probe 1b was exercised.

**All results are simulator (iPhone 17, iOS 26.4.1) and emulator (Pixel 9a, Android 16, arm64) only.**
No physical device was reachable during the spike. Timings below are therefore indicative, not
hardware-truth — `h264_videotoolbox` and `h264_mediacodec` are exactly what a simulator does not
represent faithfully. **Re-run on hardware before acting on the numbers.**

---

## 2. Single-pass composition — YES, and it matters

One `filter_complex` does trim + burned-in text + audio mix in a single encode:

```
-ss 2 -to 7 -i <src> -i <music> \
 -filter_complex "[0:v]drawtext=fontfile='<abs>':text='ReelLab':x=(w-tw)/2:y=h-220:\
                       fontsize=64:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=16[v];\
                  [1:a]atrim=0:5,asetpts=PTS-STARTPTS[m];\
                  [0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]" \
 -map "[v]" -map "[a]" -c:v <h264_videotoolbox|h264_mediacodec> -b:v 8M \
 -c:a aac -b:a 192k -movflags +faststart <out>
```

Measured against the same result produced by three chained exports, 15 s 1080×1920 source, 5 s out:

| | iOS single | iOS chained (3×) | Android single | Android chained (3×) |
|---|---|---|---|---|
| wall clock | **1217 ms** | 2753 ms | **999 ms** | 2561 ms |
| output | 5.26 MB @ 8413 kbps | 5.20 MB @ 8315 kbps | 4.64 MB @ 7427 kbps | 4.42 MB @ 7071 kbps |
| encodes of the video | **1** | **3** | **1** | **3** |

Single-pass is ~2.3–2.6× faster and re-encodes once instead of three times. The size/bitrate gap
understates the quality cost: chaining re-quantises the same pixels three times, and the loss
compounds with every extra operation the real editor adds. **Build the editor as one filter graph
per export.** The graph composes cleanly — video and audio branches are independent, so more
operations mean more filter nodes, not more passes.

### Traps confirmed by measurement, not assumption
- `-ss`/`-to` before `-i` apply to **input 0 only**. The music needed its own
  `atrim=0:5,asetpts=PTS-STARTPTS`, otherwise it plays from the wrong offset.
- `amix` halves every input by default. `normalize=0` is required or the source audio drops ~6 dB.
- `drawtext` needs an **absolute filesystem path** to a real `.ttf`. Bundled assets must be copied
  to cache first ([assets.ts](src/assets.ts)); `file://` URIs must have the scheme stripped.
- **Runtime-chosen overlay text needs two separate protections**, and getting one right hides the
  other. `text=` breaks on `:` and quotes because they are filter-graph syntax — use `textfile=`.
  But `%` and `{}` are then still expanded by drawtext *itself*: the text `50%` logs
  `Stray % near ''` once per frame, renders **nothing at all**, and still **exits 0**. A
  silent successful-looking no-op. `expansion=none` is required as well. Verified with
  `Ćao: šta ima? 50%` — diacritics, colon and percent all render correctly.
- Hardware encoders ignore `-crf`; use `-b:v`.
- Stream-copy trim snaps to the nearest keyframe — the 2→7 s copy came out **5.07 s**, not 5.00 s.
  Re-encode trims were frame-accurate. The editor must re-encode for accurate cut points.

### 2a. Gallery source — verified end-to-end on Android

The Android system photo picker was driven for real (`adb shell input tap`), a seeded 15 s
1080×1920 clip selected, and the full probe suite re-run against it. The picked asset is copied
into cache under a stable name by `adoptAsSource()` before FFmpeg sees it, so the probes get one
predictable absolute path instead of a picker-owned temp location:

```
source: /data/user/0/dev.reellab.spike/cache/spike-source.mp4
gate ✅ · trim(copy) 88 ms · trim(re-enc) 1044 ms · text 2449 ms · audio 658 ms
compose-single 968 ms  vs  compose-chained 2312 ms
```

Identical results to the bundled-sample run — a gallery clip is not a special case.

**On iOS only the module half is verified**: `expo-image-picker` registers, the permission API
answers, and photos access was granted via `simctl`. Presenting the picker needs a tap, and this
environment denied `osascript` assistive access, so the iOS simulator UI could not be driven.
One manual tap closes this.

---

## 3. The dev-client question, answered

**A custom Expo dev client is not the constraint. Dropping to bare would not have fixed anything here.**

Everything runs under `npx expo prebuild` + a custom dev client: FFmpegKit is autolinked native code,
its Expo config plugin injects the pods and the Android repository, and the New Architecture is on
(`newArchEnabled: true`, bridgeless). Every blocker hit was a **defect in the fork or in the retired
upstream distribution**, and each would have been identical in a bare RN project:

| Blocker | Root cause | Fix |
|---|---|---|
| Android dependency does not resolve | `com.arthenica:ffmpeg-kit-*` deleted from Maven Central 2025-04-01 (the group now holds only `smart-exception-*`) | point at a community republish |
| iOS pod does not resolve | podspec's `http` source → GitHub release asset → **404** | self-hosted xcframeworks |
| iOS native module silently absent | fork's `s.source` is the binary-host repo, which contains **no `.m`/`.mm`**, so `source_files` matched nothing and the pod built empty | Podfile `:path` instead of `:podspec`, plus explicit `source_files` on each subspec |
| iOS compile fails | `#import <FFmpegKitReactNativeSpec/…>` — a codegen spec the fork never generates | force the legacy `RCTBridgeModule` branch |
| Android compile fails | same missing codegen spec in the `newarch` Java source set | force the `oldarch` source set |
| Android CMake fails | `codegenConfig` in the fork's package.json makes autolinking `add_subdirectory()` a codegen dir that never exists | strip `codegenConfig` |
| Android module null at runtime | `isTurboModule = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED` → `TurboModuleManager: Unable to create module (legacy: false, turbo: true)` | register as legacy; RN 0.86's TurboModule interop bridges it |
| App crashes on FFmpeg init | `io.github.jamaismagic.*` 16 KB rebuild ships a `libavdevice.so` with unresolved `PLATFORM_hid_write` (all variants) | switch to `com.moizhassan.ffmpeg:ffmpeg-kit-16kb:6.1.1` |
| Would fail on Android 15 / Play | the fork's bundled AAR is **4 KB**-aligned (`0x1000`) | 16 KB republish, verified `0x4000` in the packaged APK |

Nine defects. None of them is an Expo restriction.

---

## 4. What actually works — the exact combination

No single published package works. This is the assembled configuration:

- **npm**: `@nikhil-cephei/ffmpeg-kit-react-native@6.0.12` — the JS API, the Expo config plugin,
  and self-hosted iOS `full-gpl` xcframeworks (the only working iOS distribution found).
- **Android native**: `com.moizhassan.ffmpeg:ffmpeg-kit-16kb:6.1.1` — 16 KB-aligned, all 4 ABIs,
  no broken symbols. Swapped in via the patch.
- **Patches**: [`patches/@nikhil-cephei+ffmpeg-kit-react-native+6.0.12.patch`](patches/) (252 lines,
  6 files) plus [`scripts/patch-ffmpeg-fork.js`](scripts/patch-ffmpeg-fork.js) for the package.json
  change patch-package cannot express.

  **After every `npm install`: `npx patch-package && node scripts/patch-ffmpeg-fork.js`**
  (this environment blocks npm lifecycle scripts, so it is not automatic).

### Build variants actually linked
| | iOS | Android |
|---|---|---|
| ffmpeg | n6.0 | n6.0 (`ffmpeg-kit-custom-…-6.0-20251215`) |
| gpl / libx264 | ✅ / ✅ | ✅ / ❌ |
| freetype / fontconfig / libass | ✅ / ✅ / ✅ | ✅ / ✅ / ✅ |
| H.264 encoder used | `h264_videotoolbox` | `h264_mediacodec` |

Android has no `libx264`, so `h264_mediacodec` is not a preference there — it is the only H.264
encoder available. **The encoder string differs per platform and must be branched in code**
(`probes.js` (removed)); everything else in the command is identical.

### Size cost
- Android, compressed in the APK: **~34 MB (arm64-v8a)**, ~43 MB (x86_64), ~64 MB (armeabi-v7a).
  A universal debug APK with all four ABIs came to 409 MB. Ship ABI splits or an App Bundle; drop
  armeabi-v7a and x86 if you can.
- iOS Pods dir 139 MB across device + simulator + Mac Catalyst slices.

---

## 5. Recommendation

**Proceed on this stack for the prototype, but do not treat it as a foundation.** The capabilities
are proven, including the one that actually shapes the architecture (single-pass composition), and
the assembled configuration is reproducible from the patch file. That is enough to build on now.

The maintenance position is genuinely bad, and this should be a scheduled decision rather than a
surprise later:

- Upstream is dead and its binaries are deleted. The npm package, the iOS binaries, and the Android
  binaries come from **three different unaffiliated individuals**, none with a maintenance
  commitment. Any one of them can delete a repo and break your build — which is precisely what
  already happened to arthenica.
- **Mirror all three artefacts into infrastructure you control before writing feature code.** This
  is the single highest-value follow-up and it is cheap.
- The fork required nine patches to work at all; every upgrade re-litigates them.
- GPL v3 (via `full-gpl`, x264 on iOS) is fine for an open-source project but forecloses closed-source
  distribution later.
- ~34 MB of native binary per ABI is a real cost for an app whose editing needs are, so far, four
  operations.

**The alternative worth pricing before committing long-term:** iOS `AVMutableComposition` +
`AVVideoCompositionCoreAnimationTool` and Android Media3 `Transformer` + `OverlayEffect`/`TextOverlay`.
Both do trim + text + audio in a single native export pass — the same architecture proven here — with
no third-party binary distribution, no licence constraint, and near-zero size cost. The price is two
native implementations instead of one filter-graph string, which this spike shows is not the saving
it appears to be: the per-platform encoder already has to be branched, and nine patches is not
"one shared implementation" either.

---

## 6. Still open

1. **Nothing has run on physical hardware.** Probe 1a (camera recording) is entirely unexecuted, and
   every timing here is simulator/emulator. Highest-priority follow-up.
2. **iOS gallery picker needs one manual tap** to confirm — see §2a. Everything downstream of it
   is already proven on iOS via the bundled sample, and the whole path is proven on Android.
3. **16 KB page size is verified structurally, not behaviourally.** The packaged `.so` files are
   `0x4000`-aligned, but the emulator reported a 4 KB page size, so nothing actually exercised a
   16 KB kernel. Needs a real Android 15+ device.
4. **Portrait rotation metadata untested.** The sample clip is natively 1080×1920 with no rotation
   matrix; real phone footage carries one, and `drawtext` interacts with it badly. Test with a
   recorded clip.
5. **Filmstrip API choice is unresolved and platform-inverted:** `expo-video` was ~3× faster on iOS
   (147 vs 405 ms/frame) and ~8× slower on Android (447 vs 53 ms/frame). Both beat shelling out to
   ffmpeg for UI purposes. Re-measure on hardware before picking.
6. Long-clip behaviour, memory ceilings, cancellation, and progress reporting are all untested.

---

## 6a. The app now wears the spike's design

The UI is implemented from the Claude Design project **"React Native video-processing
spike"** (`Video Editor Spike.dc.html`, artboards 1a–1e), pulled through the design MCP.
Tokens live in [src/theme.tsx](src/theme.tsx) — the single source of truth. (An earlier draft
mirrored them into a `tailwind.config.js`; Tailwind was never added to this project and that
file does not exist.)

| Screen | File | Wired to |
|---|---|---|
| 1a Camera | [CameraScreen.tsx](src/screens/CameraScreen.tsx) | `expo-camera` `recordAsync()` |
| 1b Clip library | `ClipsScreen.tsx` (removed as dead code) | real duration/size/poster frame per clip |
| 1c Editor | [EditorScreen.tsx](src/screens/EditorScreen.tsx) | real filmstrip, scrub, trim/text/audio params |
| 1d Export | [ExportScreen.tsx](src/screens/ExportScreen.tsx) | **FFmpeg's own statistics callback** |
| 1e Result | [ResultScreen.tsx](src/screens/ResultScreen.tsx) | `ffprobe` on the actual output |

Nothing on these screens is mocked: the percentage is real encode progress, the stats are
read back off the exported file, and the tabs stage parameters that [export.ts](src/export.ts)
composes into **one** `filter_complex`.

The design's per-platform split is implemented rather than flattened: iOS gets Helvetica Neue,
a 30px/600 large title and sentence-case rounded-rect buttons; Android gets Roboto, a 21px/500
title and tracked-out uppercase pills.

**Deviations, all deliberate:**
- The design's diagonal-stripe placeholders are flat `#191A1E`. RN has no repeating linear
  gradient, and the app shows real frames in those slots anyway.
- Trim handles are rendered but not draggable — the design's own interaction is
  *Set in at playhead* / *Set out*, plus tap-to-scrub on the filmstrip.
- Added an **Import from gallery** action to 1b. Not in the design, but the iOS simulator has
  no camera, so it is the only way to get a clip in there.
- Added a **Capability probes** link to reach the measurement harness, which the design does
  not cover and which is the evidence behind everything above.

### Media-library API and permission scope

`saveToLibraryAsync()` is deprecated in SDK 57. Saving now uses the class-based API —
`Asset.create(uri)` plus `requestPermissionsAsync()` — in
[ResultScreen.tsx](src/screens/ResultScreen.tsx).

Two things that only showed up on a real permission prompt:

- **`writeOnly` is an iOS-only idea.** On iOS it maps to the minimal add-only Photos
  permission. On Android 13+ it asks for `WRITE_EXTERNAL_STORAGE`, which is no longer
  grantable, so the request is denied outright and the save fails with no dialog. The call
  is now `requestPermissionsAsync(isIOS, ['video'])`.
- **Expo asks for every granular permission by default.** The first working prompt asked
  the user for access to *music and audio* — for a video app. `granularPermissions: ['video']`
  in both the `app.json` plugin and the runtime call trims the manifest to `READ_MEDIA_VIDEO`
  + `READ_MEDIA_VISUAL_USER_SELECTED` and reduces it to one dialog.

Verified on the emulator: with only those two permissions granted, the export lands at
`/storage/emulated/0/DCIM/reellab-export.mp4` and is registered in the media store.

### One bug this build surfaced

The Export screen reported `Audio mix · spike-music.m4a — IN PASS` while the exported file
contained no music: the editor's `music` toggle is a boolean, but `buildComposeCommand`
needs a `musicPath`, and `undefined` silently took the no-audio branch. Caught by measuring
the output, not by reading the screen — the same lesson as the `expansion=none` trap in §2.
After the fix, verified from the UI end-to-end on the Android emulator: the source tone drops
exactly 18 dB (−21.1 → −39.1, matching `originalGainDb`), the music band lifts, and
`Vent B 2.4 bar` is burned in — all in a single pass.

---

## 7. Reproducing

```bash
npm install && npx patch-package && node scripts/patch-ffmpeg-fork.js
npx expo prebuild --clean
npx expo run:ios --device <udid>      # or: npx expo run:android --device
```

**No longer reproducible as written.** The probes harness — its tab, `RUN ALL`, the
`spike-results.json` dump and the `AUTORUN` flag — was removed once the measurements below were
taken. The app's tabs are now Feed, Create and Profile — My videos moved into the
profile page. The `assets/spike/sample.mp4` fixture is no longer committed: nothing loaded it,
and it is regenerable from `scripts/media/encode.sh`.

**And the code is not throwaway any more.** What was `spike/` is now `src/`, and it holds the
production feed pager, the video player pool, the theme, and the comments and profile modules.
The FFmpeg findings below are what remains genuinely spike-shaped.
