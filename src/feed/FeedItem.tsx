// One full-screen feed row.
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { VideoView } from "expo-video";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-screens/experimental";
import { font, isIOS, themedStyles } from "../theme";
import { compactCount } from "../format";
import type { VideoPlayer, VideoPlayerStatus } from "expo-video";
import type { Clip } from "../types";

export default function FeedItem({
  clip,
  player,
  height,
  isActive,
  muted,
  onTogglePlay,
  onToggleMute,
  onComments,
  onToggleLike,
  liked,
  likeCount,
  onOpenProfile,
  canEdit,
  onEdit,
}: {
  clip: Clip;
  /** Null while the row sits outside the pool's window. */
  player: VideoPlayer | null;
  height: number;
  isActive: boolean;
  /**
   * Mute is the FEED's state, not the row's: the row is recycled and its player is lent to
   * it, so anything kept here would be lost on the next swipe or belong to a different clip.
   *
   * Whether the clip is PLAYING is deliberately not a prop — it is read off the player, so
   * an interruption that pauses playback behind our back still shows correctly.
   */
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  /**
   * Null for a clip that only exists on this device. Comments hang off a server row, so a
   * local clip gets no affordance at all rather than one that fails.
   */
  onComments: (() => void) | null;
  /** Null for a local clip, for the same reason. Also disables the double-tap gesture. */
  onToggleLike: (() => void) | null;
  liked: boolean;
  likeCount: number;
  /** Null when the clip carries no owner — a locally recorded one never does. */
  onOpenProfile: (() => void) | null;
  /** False for someone else's clip — the long-press and its hint are then withheld. */
  canEdit: boolean;
  onEdit: () => void;
}) {
  const s = useStyles();
  const [firstFrame, setFirstFrame] = useState(false);

  // Without this a clip whose source fails to load is a black rectangle forever —
  // indistinguishable from one that is merely slow.
  //
  // Subscribed by hand rather than with expo's useEvent: that hook calls addListener
  // unconditionally, and most rows have no player — the pool only lends one to the window
  // around the active index. "idle" is that state, and it is not an error.
  const [status, setStatus] = useState<VideoPlayerStatus>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!player) {
      setStatus("idle");
      setFailure(null);
      return;
    }
    try {
      setStatus(player.status);
    } catch {
      return; // released between render and effect
    }
    setFailure(null);
    const sub = player.addListener("statusChange", ({ status: next, error }) => {
      setStatus(next);
      setFailure(error?.message ?? null);
    });
    return () => sub.remove();
  }, [player, clip.id]);

  const failed = status === "error";
  const buffering = status === "loading" && !firstFrame;

  // Read off the player rather than assumed from our own intent. The OS pauses playback
  // behind our back when a call arrives or another app takes audio focus, and a badge that
  // tracked only our intent would go on claiming the clip was playing.
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!player || !isActive) {
      setPlaying(false);
      setProgress(0);
      return;
    }
    try {
      setPlaying(player.playing);
    } catch {
      return; // released between render and effect
    }
    const subs = [
      player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying)),
      player.addListener("timeUpdate", ({ currentTime }) => {
        try {
          // duration is 0 until the source is ready; guard so the bar never divides by it.
          const total = player.duration;
          setProgress(total > 0 ? Math.min(1, currentTime / total) : 0);
        } catch {
          // released between the event firing and this reading it
        }
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [player, clip.id, isActive]);

  function retry() {
    if (!player) return;
    try {
      // Reload only. Whether it should then be playing is the pool's decision, not this
      // row's — calling play() here started audio on a row that was not even active.
      player.replace({ uri: clip.uri });
    } catch {
      // the pool took the player back; the next swipe will reassign one
    }
  }

  // A recycled player means a different clip: show the poster again until the new
  // first frame lands, or the previous clip's last frame flashes through.
  useEffect(() => {
    setFirstFrame(false);
  }, [player, clip.id]);

  // Two gestures, distinguished by a timer rather than by a gesture library.
  //
  // A tap is held for the length of a double-tap window instead of firing at once. If a
  // second tap lands inside that window the first is cancelled and the pair becomes a
  // double tap; otherwise the held tap fires as a single. That is why play/pause carries
  // ~220ms of latency — it is the cost of the two being distinguishable at all, and it was
  // paid up front when this only had one gesture.
  //
  // Vertical scrolling is untouched by any of it: the list's touch responder takes the
  // gesture the moment the finger moves, so neither tap ever fires during a swipe.
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTap = useCallback(() => {
    if (pendingTap.current === null) return false;
    clearTimeout(pendingTap.current);
    pendingTap.current = null;
    return true;
  }, []);

  // A row unmounting with a tap still pending must not fire it into a recycled player.
  useEffect(() => {
    return () => {
      clearPendingTap();
    };
  }, [clearPendingTap]);

  const onTap = useCallback(() => {
    // A tap arriving while one is pending IS the second tap of a double tap: cancel the
    // held single tap and run the double-tap action in its place. Playback is untouched,
    // so a double tap likes without also pausing.
    if (clearPendingTap()) {
      onToggleLike?.();
      return;
    }
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      onTogglePlay();
    }, DOUBLE_TAP_WINDOW_MS);
  }, [clearPendingTap, onTogglePlay, onToggleLike]);

  return (
    <View style={[s.root, { height }]}>
      {/* Poster underneath: covers the gap between swipe and first decoded frame. */}
      {clip.thumb && !firstFrame ? (
        <Image source={clip.thumb} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}

      {player ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={() => setFirstFrame(true)}
        />
      ) : null}

      {/*
        A plain Pressable, not a gesture handler: inside a scrolling list the touch
        responder already hands the gesture to the list the moment the finger moves, so
        a tap and a vertical swipe never compete.

        A screen reader delivers one activation per gesture, so this surface gives those
        users play/pause and nothing else — the double tap is not reachable that way, which
        is exactly why liking has its own button rather than living only in the gesture.
      */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onTap}
        onLongPress={canEdit ? onEdit : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause video" : "Play video"}
        // No hint naming the clip: a hint says what activating does, and the title and
        // author are already their own elements further down the row.
      />

      {/* Gated on isActive like every other overlay here: a neighbour in the pool window that
          failed to load was rendering a tappable panel off-screen. */}
      {failed && isActive ? (
        <Pressable
          style={s.failure}
          onPress={retry}
          accessibilityRole="button"
          // Labelled explicitly rather than left to be read off its children: the visible
          // copy says "Tap to retry", which is wrong for a screen reader — there the
          // gesture is a double tap.
          accessibilityLabel="Retry loading this clip"
        >
          <Text style={s.failureText}>This clip could not be played.</Text>
          <Text style={s.failureHint}>{failure ?? "Tap to retry."}</Text>
        </Pressable>
      ) : null}

      {buffering ? (
        <View pointerEvents="none" style={s.buffering}>
          <ActivityIndicator color="rgba(255,255,255,0.75)" />
        </View>
      ) : null}

      {/* Shown whenever the active clip is not running — whether the viewer paused it or
          an interruption did — so the badge is never a lie about what is happening.
          Gated on readyToPlay so it does not flash during the load before the first play. */}
      {isActive && !playing && status === "readyToPlay" ? (
        <View pointerEvents="none" style={s.pausedBadge}>
          <Text style={s.pausedGlyph}>▶</Text>
        </View>
      ) : null}

      {/*
        The picture runs under the tab bar and the status bar; the caption must not.
        This SafeAreaView is the one from react-native-screens, not safe-area-context —
        on Android its inset is fed by the tab container's own measured bar height, so the
        caption clears the bar without a hardcoded number to go stale.
      */}
      {/*
        Painted outside the safe area, on purpose: anchored to the row's own bottom edge so
        the fade runs off the screen instead of stopping at the inset. Inside the SafeAreaView
        it ended on a visible line under the tab bar, with the picture brighter below it.
      */}
      <View pointerEvents="none" style={s.scrim} />

      {/* box-none, not none: the caption stays untouchable but the mute button inside
          must still receive taps. */}
      <SafeAreaView pointerEvents="box-none" edges={SAFE_EDGES} style={StyleSheet.absoluteFill}>
        {/*
          One rail, laid out by flex rather than three buttons each carrying a hand-tuned
          absolute `top` — those offsets had to be re-derived every time a button changed
          height. box-none so the gaps between buttons stay tappable for play/pause.
        */}
        {isActive ? (
          <View pointerEvents="box-none" style={s.rail}>
            <RailButton
              label={muted ? "MUTED" : "SOUND"}
              caption={muted ? "off" : "on"}
              active={!muted}
              onPress={onToggleMute}
              accessibilityLabel={muted ? "Unmute" : "Mute"}
              selected={muted}
              s={s}
            />

            {/*
              The gesture is a shortcut, never the only way in. Someone using a screen
              reader, or anyone who simply does not know about the double tap, likes from
              here — and this button is what carries the count.
            */}
            {onToggleLike ? (
              <RailButton
                label="LIKE"
                caption={compactCount(likeCount)}
                active={liked}
                onPress={onToggleLike}
                accessibilityLabel={liked ? "Unlike" : "Like"}
                selected={liked}
                accessibilityValue={{ text: `${likeCount} likes` }}
                s={s}
              />
            ) : null}

            {onComments ? (
              <RailButton
                label="CHAT"
                active={false}
                onPress={onComments}
                accessibilityLabel="Comments"
                s={s}
              />
            ) : null}

            {/*
              The design carries a share control here. Nothing in the app shares a clip yet,
              so it renders as the shape it will be rather than as a button that would do
              nothing when pressed — not focusable, not announced as actionable.
            */}
            <View style={s.railItem} importantForAccessibility="no-hide-descendants">
              <View style={s.railCircle}>
                <Text style={s.railGlyph}>SHARE</Text>
              </View>
              <Text style={s.railCaption}>{compactCount(0)}</Text>
            </View>
          </View>
        ) : null}

        {/* box-none so the caption stays untouchable but the author link does not. */}
        <View pointerEvents="box-none" style={s.overlay}>
          <Text style={s.title} numberOfLines={2}>
            {clip.name}
          </Text>
          {onOpenProfile ? (
            <Pressable
              onPress={onOpenProfile}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel={`View ${clip.ownerName ?? "this user"}'s profile`}
            >
              <Text style={s.owner}>@{clip.ownerName ?? "unknown"}</Text>
            </Pressable>
          ) : (
            <Text style={s.owner}>@{clip.ownerName ?? "unknown"}</Text>
          )}
          {canEdit ? <Text style={s.hint}>hold to edit</Text> : null}
        </View>

        {/*
          Inside the safe area, unlike the scrim: at the row's true bottom edge the bar
          would be hidden underneath the tab bar, which the picture runs beneath.

          An indicator, not a scrubber — this task assigns one gesture, and a draggable
          bar along the bottom of a vertical pager would compete with the swipe.
        */}
        {isActive ? (
          <View
            style={s.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Playback progress"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          >
            <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

// Top too: the picture reaches under the status bar, so the caption block must be inset
// at both ends. Hoisted so the object identity is stable across renders.
const SAFE_EDGES = { top: true, bottom: true };

// Long enough to catch a deliberate double tap, short enough that the play/pause toggle
// still feels like a response rather than a lag. Platform double-tap windows sit around
// 200-300ms; this is at the fast end of that on purpose.
const DOUBLE_TAP_WINDOW_MS = 220;

/**
 * One control on the feed's right-hand rail — a labelled disc with a count beneath it.
 *
 * The design writes the icons as monospace words rather than glyphs, which is why no icon
 * library is needed here.
 */
function RailButton({
  label,
  caption,
  active,
  onPress,
  accessibilityLabel,
  accessibilityValue,
  selected,
  s,
}: {
  label: string;
  /** The number or state beneath the disc. Omitted where there is nothing to count. */
  caption?: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityValue?: { text: string };
  selected?: boolean;
  s: ReturnType<typeof useStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={s.railItem}
      // The label is small; the touch target must not be.
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      accessibilityValue={accessibilityValue}
    >
      <View style={[s.railCircle, active && s.railCircleActive]}>
        <Text style={s.railGlyph}>{label}</Text>
      </View>
      {caption ? (
        <Text style={[s.railCaption, active && s.railCaptionActive]}>{caption}</Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { width: "100%", backgroundColor: "#000", position: "relative" },
  pausedBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -34,
    width: 68,
    height: 68,
    borderRadius: 99,
    backgroundColor: "rgba(10,10,11,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  pausedGlyph: { fontSize: 26, color: "#fff", marginLeft: 4 },
  // Sits above the tap-to-pause Pressable so the retry gets the touch, and stays inside
  // the middle of the row so the caption below it is still readable.
  failure: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "50%",
    marginTop: -44,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "rgba(10,10,11,0.72)",
    alignItems: "center",
    gap: 6,
  },
  failureText: { fontFamily: font.sans, fontSize: 14, fontWeight: "600", color: "#fff" },
  failureHint: {
    fontFamily: font.mono,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  buffering: { position: "absolute", alignSelf: "center", top: "50%", marginTop: -12 },
  // Bottom-anchored beside the caption, as in design 2a — the caption reserves room for it
  // with its own right padding rather than the two overlapping.
  rail: { position: "absolute", right: 14, bottom: 18, alignItems: "center", gap: 18 },
  railItem: { alignItems: "center", gap: 4 },
  railCircle: {
    // 44pt is the documented minimum touch target on both platforms; Android's own guidance
    // rounds it up, which is the size the design draws there.
    width: isIOS ? 44 : 46,
    height: isIOS ? 44 : 46,
    borderRadius: 99,
    backgroundColor: c.w10,
    alignItems: "center",
    justifyContent: "center",
  },
  // Filled accent once the control is on — the design's way of showing state without
  // needing a second icon.
  railCircleActive: { backgroundColor: c.accent },
  railGlyph: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", color: "#FFFFFF" },
  railCaption: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", color: c.w75 },
  railCaptionActive: { color: "#FFFFFF" },
  progressTrack: {
    width: "100%",
    height: 2.5,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  progressFill: { height: "100%", backgroundColor: "rgba(255,255,255,0.85)" },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Tall enough that the fade reads as a gradient rather than a grey band, and tall
    // enough to start above the caption — which sits roughly 170pt off the bottom once
    // the safe-area inset is counted.
    height: 240,
    experimental_backgroundImage:
      "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.62) 100%)",
  },
  overlay: {
    // Bottom-anchored inside the safe area rather than absolutely positioned, so the
    // inset actually applies. The scrim behind it is NOT inset — see above.
    marginTop: "auto",
    paddingLeft: 18,
    // Clear of the rail, which is bottom-anchored on the same edge.
    paddingRight: 78,
    paddingBottom: 18,
    gap: 4,
  },
  title: {
    fontFamily: font.sans,
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
  },
  owner: { fontFamily: font.mono, fontSize: 11.5, color: "rgba(255,255,255,0.75)" },
  hint: { fontFamily: font.mono, fontSize: 9.5, letterSpacing: 0.76, color: "rgba(255,255,255,0.45)" },
}));
