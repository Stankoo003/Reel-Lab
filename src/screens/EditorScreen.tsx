// Design 1c — Editor: timeline + trim / text / audio tabs.
// The tabs are not a pipeline: they stage parameters, and Export runs one pass.
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, PanResponder } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import Animated, { LinearTransition } from "react-native-reanimated";
import { Image } from "expo-image";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import { useFilmstrip } from "../hooks/useFilmstrip";
import { useTrimmedPlayback } from "../hooks/useTrimmedPlayback";
import { clampIn, clampOut } from "../trim";
import { timecode } from "../clips";
import { MUTE_DB } from "../export";
import {
  clamp01,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  NEW_TEXT_X,
  NEW_TEXT_Y,
  TEXT_COLORS,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SIZE_PRESETS,
  textBoxPad,
  textFontPx,
} from "../export";
import type { Clip, EditSettings, TextElement, TextSizePreset } from "../types";
import { MUSIC_CREDIT, MUSIC_TRACKS } from "../assets";
import type { MusicTrack } from "../assets";
import type { Dispatch, SetStateAction } from "react";

const FRAME_COUNT = 10;

/** m:ss for a bed length. */
function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds - m * 60)).padStart(2, "0")}`;
}

/**
 * What the export will do to this bed at the current cut length — stated up front, because
 * the loop/trim decision is invisible until the file comes out. Mirrors src/export.ts.
 */
function fitLabel(track: { seconds: number }, clipLength: number) {
  const cut = Math.max(0.1, clipLength);
  if (track.seconds < cut - 0.05) return `loops to ${cut.toFixed(1)}s`;
  if (track.seconds > cut + 0.05) return `trimmed to ${cut.toFixed(1)}s`;
  return "exact fit";
}

/** A rect in preview pixels. */
type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where the video actually sits inside the 16:9 preview box under contentFit="contain".
 *
 * The overlay must be positioned against the PICTURE, not against the box — a portrait
 * clip is letterboxed, and placing a caption at y=0.9 of the box would put it on the black
 * bar, somewhere the exported frame has nothing at all.
 */
function fitRect(aspect: number, box: { w: number; h: number }): Rect {
  if (!box.w || !box.h || !aspect) return { x: 0, y: 0, w: box.w, h: box.h };
  const wide = aspect > box.w / box.h;
  const w = wide ? box.w : box.h * aspect;
  const h = wide ? box.w / aspect : box.h;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

let textSeq = 0;

function newTextElement(): TextElement {
  textSeq += 1;
  return {
    id: `t${Date.now().toString(36)}-${textSeq}`,
    text: "",
    x: NEW_TEXT_X,
    y: NEW_TEXT_Y,
    size: TEXT_SIZE_PRESETS.M,
    color: TEXT_COLORS[0],
  };
}

/**
 * One caption on the preview, draggable with PanResponder.
 *
 * PanResponder rather than a gesture library on purpose: react-native-gesture-handler is
 * not installed, and adding it would force a dev-client rebuild for everyone.
 *
 * The drag is local state while the finger is down and is committed to the edit settings
 * on release — one settings update per gesture instead of one per frame, which keeps the
 * filmstrip and the panel from re-rendering 60 times a second.
 */
function CaptionGhost({
  el,
  rect,
  draggable,
  selected,
  onSelect,
  onCommit,
}: {
  el: TextElement;
  rect: Rect;
  draggable: boolean;
  selected: boolean;
  onSelect: () => void;
  onCommit: (x: number, y: number) => void;
}) {
  const s = useStyles();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // The PanResponder is created once, so everything it reads lives in refs.
  const live = useRef({ el, rect, draggable, onSelect, onCommit });
  live.current = { el, rect, draggable, onSelect, onCommit };
  const from = useRef({ x: 0, y: 0 });
  const at = useRef({ x: 0, y: 0 });

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => live.current.draggable,
        onMoveShouldSetPanResponder: () => live.current.draggable,
        onPanResponderGrant: () => {
          from.current = { x: live.current.el.x, y: live.current.el.y };
          at.current = from.current;
          setDrag(from.current);
          live.current.onSelect();
        },
        onPanResponderMove: (_e, g) => {
          const r = live.current.rect;
          if (!r.w || !r.h) return;
          at.current = {
            x: clamp01(from.current.x + g.dx / r.w),
            y: clamp01(from.current.y + g.dy / r.h),
          };
          setDrag(at.current);
        },
        onPanResponderRelease: () => {
          live.current.onCommit(at.current.x, at.current.y);
          setDrag(null);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    []
  );

  const pos = drag ?? { x: el.x, y: el.y };
  // The same two helpers the exporter uses — see src/export.ts.
  const fontSize = textFontPx(el, rect.h || DEFAULT_FRAME_HEIGHT);
  const pad = textBoxPad(fontSize);

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[
        s.caption,
        {
          left: rect.x + pos.x * rect.w - box.w / 2,
          top: rect.y + pos.y * rect.h - box.h / 2,
          paddingHorizontal: pad,
          paddingVertical: Math.round(pad * 0.5),
        },
        draggable && (selected ? s.captionSelected : s.captionIdle),
      ]}
    >
      <Text
        style={[s.captionText, { fontSize, lineHeight: Math.round(fontSize * 1.2), color: el.color }]}
      >
        {el.text}
      </Text>
    </View>
  );
}

function Bar({
  value,
  onChange,
  tint,
}: {
  /** 0…1. */
  value: number;
  onChange: (value: number) => void;
  tint: string;
}) {
  const width = useRef(0);
  const s = useStyles();

  return (
    <Pressable
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (!width.current) return;
        onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / width.current)));
      }}
      hitSlop={12}
      style={s.barTrack}
    >
      <View style={[s.barFill, { width: `${value * 100}%`, backgroundColor: tint }]} />
      <View style={[s.barKnob, { left: `${value * 100}%` }]} />
    </Pressable>
  );
}

/*
 * Growing the preview and collapsing the tools is one layout change, so it is animated as
 * one: without it the panel vanishes and the video jumps, and the eye has to re-find both.
 */
const RESIZE = LinearTransition.duration(240);

type Tab = "trim" | "text" | "audio" | "info";

export default function EditorScreen({
  clip,
  settings,
  setSettings,
  onCancel,
  onExport,
}: {
  clip: Clip;
  settings: EditSettings;
  setSettings: Dispatch<SetStateAction<EditSettings | null>>;
  onCancel: () => void;
  onExport: () => void;
}) {
  const { c, type, tabState } = useTheme();
  const s = useStyles();
  const [tab, setTab] = useState<Tab>("trim");
  const [position, setPosition] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(0);
  const stripWidth = useRef(0);
  const [previewBox, setPreviewBox] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Preview takes the whole screen and the tools step aside. Tools are collapsed rather
  // than unmounted, so the filmstrip does not re-extract its frames on every toggle.
  const [expanded, setExpanded] = useState(false);

  const player = useVideoPlayer(clip.uri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });
  // Subscribed, not read off the player in render — see usePlayerPlaying.
  const playing = usePlayerPlaying(player);

  useEffect(() => {
    const sub = player.addListener("timeUpdate", (e) => setPosition(e.currentTime ?? 0));
    return () => sub.remove();
  }, [player]);

  // A clip adopted from the gallery can arrive with duration 0; the player knows
  // better once the source is loaded, and the filmstrip needs a real length to
  // space its frames proportionally.
  useEffect(() => {
    const sub = player.addListener("sourceLoad", (e) => setLoadedDuration(e.duration ?? 0));
    return () => sub.remove();
  }, [player]);

  const duration = clip.duration > 0 ? clip.duration : loadedDuration || 1;

  // Frames arrive one at a time, off the JS thread, with progress — see useFilmstrip.
  const strip = useFilmstrip(player, clip.duration > 0 ? clip.duration : loadedDuration, FRAME_COUNT);

  const set = (patch: Partial<EditSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));

  // While a handle is dragged the range lives here, not in the shared settings:
  // committing every move into the editor context would re-render every consumer of
  // it at touch frequency. The commit happens once, on release.
  const [drag, setDrag] = useState<{ in: number; out: number } | null>(null);
  const trimIn = drag ? drag.in : settings.trimIn;
  const trimOut = drag ? drag.out : settings.trimOut;

  // The preview obeys the selection: playback loops inside [in, out].
  const { playInRange, seek } = useTrimmedPlayback(player, trimIn, trimOut, setPosition);

  // Latest values for the pan handlers, which are created once and must not close
  // over a stale render.
  const live = useRef({ duration, trimIn, trimOut, setSettings });
  live.current = { duration, trimIn, trimOut, setSettings };
  const dragRef = useRef<{ in: number; out: number } | null>(null);
  const lastSeek = useRef(0);

  // PanResponder, not react-native-gesture-handler: gesture-handler is not a
  // dependency of this app and adding it would force a dev-client rebuild. Reanimated
  // is available, but a worklet-driven handle would still have to hop back to JS for
  // every in/out value — the trim points are React state that Export reads — so the
  // UI-thread animation buys nothing here. Two handles on a 56pt strip is exactly
  // what the built-in responder system is for.
  const pans = useMemo(() => {
    const make = (edge: "in" | "out") => {
      let startIn = 0;
      let startOut = 0;
      const begin = () => {
        startIn = live.current.trimIn;
        startOut = live.current.trimOut;
        dragRef.current = { in: startIn, out: startOut };
        setDrag(dragRef.current);
      };
      const commit = () => {
        const d = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (d) live.current.setSettings((prev) => (prev ? { ...prev, trimIn: d.in, trimOut: d.out } : prev));
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: begin,
        onPanResponderMove: (_e, g) => {
          const width = stripWidth.current;
          const { duration } = live.current;
          if (!width) return;
          // dx-based, so no page/window coordinates are needed and the handle never
          // jumps to the finger on grant.
          const delta = (g.dx / width) * duration;
          const next =
            edge === "in"
              ? { in: clampIn(startIn + delta, startOut), out: startOut }
              : { in: startIn, out: clampOut(startOut + delta, startIn, duration) };
          dragRef.current = next;
          setDrag(next);
          // Scrub the preview to the edge being dragged, throttled — seeking on every
          // touch move floods the native player.
          const now = Date.now();
          if (now - lastSeek.current > 80) {
            lastSeek.current = now;
            seek(edge === "in" ? next.in : next.out);
          }
        },
        onPanResponderRelease: commit,
        onPanResponderTerminate: commit,
      });
    };
    return { in: make("in"), out: make("out") };
  }, [seek]);

  const inPct = (trimIn / duration) * 100;
  const outPct = 100 - (trimOut / duration) * 100;
  const playPct = Math.max(0, Math.min(100, (position / duration) * 100));
  const length = Math.max(0, trimOut - trimIn);

  // --- text overlay -------------------------------------------------------------------
  //
  // The real frame size, once expo-video reports it. Font sizes and the preview rect are
  // both derived from it, so what the ghost shows is what drawtext will burn in. Until it
  // arrives (or if the platform never reports it) the export falls back to 1920×1080.
  useEffect(() => {
    const apply = (size?: { width: number; height: number } | null) => {
      if (!size?.width || !size?.height) return;
      set({ frameWidth: size.width, frameHeight: size.height });
    };
    apply(player.videoTrack?.size);
    const loaded = player.addListener("sourceLoad", (e) => apply(e.availableVideoTracks?.[0]?.size));
    const changed = player.addListener("videoTrackChange", (e) => apply(e.videoTrack?.size));
    return () => {
      loaded.remove();
      changed.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const texts = settings.texts ?? [];
  const frameW = settings.frameWidth || DEFAULT_FRAME_WIDTH;
  const frameH = settings.frameHeight || DEFAULT_FRAME_HEIGHT;
  const videoRect = useMemo(() => fitRect(frameW / frameH, previewBox), [frameW, frameH, previewBox]);
  const selected = texts.find((t) => t.id === selectedId) ?? null;

  const patchText = (id: string, patch: Partial<TextElement>) =>
    set({ texts: texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const addText = () => {
    const el = newTextElement();
    // Stagger new elements so a second one does not land exactly on the first.
    const nth = texts.length;
    el.y = clamp01(NEW_TEXT_Y - nth * 0.12);
    set({ texts: [...texts, el] });
    setSelectedId(el.id);
  };

  const removeText = (id: string) => {
    // Removing the last element leaves an empty array, and an empty array means the graph
    // gets no drawtext at all — that is the clean-export criterion.
    set({ texts: texts.filter((t) => t.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };


  function seekFromStrip(x: number) {
    if (!stripWidth.current) return;
    const t = Math.max(0, Math.min(duration, (x / stripWidth.current) * duration));
    seek(t);
  }

  const tabs: [Tab, string][] = [
    ["trim", "TRIM"],
    ["text", "TEXT"],
    ["audio", "AUDIO"],
    ["info", "INFO"],
  ];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={type.action}>Cancel</Text>
        </Pressable>
        {/* Follows the INFO tab, so typing a title shows up where the title belongs rather
            than only on the screen two steps later. Falls back to the filename. */}
        <Text style={s.headerTitle} numberOfLines={1}>
          {settings.title.trim() || clip.name}
        </Text>
        <Pressable onPress={onExport} hitSlop={10}>
          <Text style={s.exportLink}>Export</Text>
        </Pressable>
      </View>

      <Animated.View
        layout={RESIZE}
        style={[s.preview, expanded && s.previewExpanded]}
        onLayout={(e) =>
          setPreviewBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        {/*
          Sits above the video but BELOW the captions and the play button, so those keep
          their own taps and only a press on the picture itself resizes. A caption drag in
          the TEXT tab is therefore never mistaken for a resize.
        */}
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Shrink preview" : "Expand preview to full screen"}
        />
        <Text style={s.previewMeta}>source clip · {clip.durationLabel}</Text>
        {/* Named, not just implied by the tap — an invisible affordance is no affordance. */}
        <View pointerEvents="none" style={s.sizeChip}>
          <Text style={s.sizeChipText}>{expanded ? "TAP TO SHRINK" : "TAP TO EXPAND"}</Text>
        </View>
        {texts.map((el) => (
          <CaptionGhost
            key={el.id}
            el={el}
            rect={videoRect}
            draggable={tab === "text"}
            selected={el.id === selectedId}
            onSelect={() => setSelectedId(el.id)}
            onCommit={(x, y) => patchText(el.id, { x, y })}
          />
        ))}
        <Pressable
          onPress={() => (playing ? player.pause() : playInRange())}
          style={s.playButton}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause preview" : "Play preview"}
        >
          <Text style={s.playLabel}>{playing ? "PAUSE" : "PLAY"}</Text>
        </Pressable>
      </Animated.View>

      <View style={s.timeRow}>
        <Text style={type.meta}>
          <Text style={{ color: c.text }}>{timecode(position)}</Text> / {timecode(duration)}
        </Text>
        <Text style={type.meta}>30 fps</Text>
      </View>

      {/*
        The tools. Collapsed with display:none rather than unmounted — dropping them would
        throw away the extracted filmstrip and make every toggle re-decode the clip.
      */}
      <View style={expanded ? s.toolsHidden : s.tools}>
      <View style={s.stripWrap}>
        <Pressable
          style={s.strip}
          onLayout={(e) => (stripWidth.current = e.nativeEvent.layout.width)}
          onPress={(e) => seekFromStrip(e.nativeEvent.locationX)}
        >
          <View style={s.stripRow}>
            {strip.frames.map((f, i) =>
              f ? (
                <Image key={i} source={f} style={s.frame} contentFit="cover" />
              ) : (
                <View key={i} style={[s.frame, s.frameEmpty]} />
              )
            )}
          </View>
          <View style={[s.scrim, { left: 0, width: `${inPct}%` }]} />
          <View style={[s.scrim, { right: 0, width: `${outPct}%` }]} />
          <View style={[s.selection, { left: `${inPct}%`, right: `${outPct}%` }]} />
          {strip.extracting ? (
            <View style={[s.stripProgress, { width: `${strip.progress * 100}%` }]} />
          ) : null}
          {/* Touch target is wider than the 12pt bar the design draws — a finger is not
              12pt wide. The bar stays exactly where the design puts it. */}
          <View
            {...pans.in.panHandlers}
            style={[s.handleHit, { left: `${inPct}%` }]}
            hitSlop={{ top: 12, bottom: 12 }}
            accessibilityRole="adjustable"
            accessibilityLabel="Trim in point"
            accessibilityValue={{ text: timecode(trimIn) }}
          >
            <View style={[s.handle, drag ? s.handleActive : null]}>
              <View style={s.handleGrip} />
            </View>
          </View>
          <View
            {...pans.out.panHandlers}
            style={[s.handleHit, { left: `${100 - outPct}%` }]}
            hitSlop={{ top: 12, bottom: 12 }}
            accessibilityRole="adjustable"
            accessibilityLabel="Trim out point"
            accessibilityValue={{ text: timecode(trimOut) }}
          >
            <View style={[s.handle, drag ? s.handleActive : null]}>
              <View style={s.handleGrip} />
            </View>
          </View>
          <View style={[s.playhead, { left: `${playPct}%` }]} />
        </Pressable>
        <View style={s.stripLegend}>
          <Text style={s.legendText}>00:00</Text>
          <Text style={[s.legendText, strip.error ? { color: c.recText } : null]}>
            {strip.error
              ? strip.error
              : strip.extracting
                ? `extracting frames ${strip.done}/${strip.count}`
                : `drag handles · tap to scrub · ${strip.count} frames`}
          </Text>
          <Text style={s.legendText}>{timecode(duration)}</Text>
        </View>
      </View>

      <View style={s.tabs}>
        {tabs.map(([key, label]) => {
          const st = tabState(tab === key);
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[s.tab, { backgroundColor: st.backgroundColor }]}
            >
              <Text style={[s.tabLabel, { color: st.color }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.panel}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {tab === "trim" ? (
            <View>
              <View style={s.cardRow}>
                <View style={s.card}>
                  <Text style={type.label}>IN</Text>
                  <Text style={s.cardValue}>{timecode(trimIn)}</Text>
                </View>
                <View style={s.card}>
                  <Text style={type.label}>OUT</Text>
                  <Text style={s.cardValue}>{timecode(trimOut)}</Text>
                </View>
                <View style={[s.card, s.cardAccent]}>
                  <Text style={[type.label, { color: "rgba(76,141,246,0.85)" }]}>LENGTH</Text>
                  <Text style={[s.cardValue, { color: c.accentSoft }]}>{length.toFixed(2)}s</Text>
                </View>
              </View>
              <View style={s.ghostRow}>
                <Pressable
                  onPress={() => set({ trimIn: clampIn(position, settings.trimOut) })}
                  style={s.ghost}
                >
                  <Text style={s.ghostText}>Set in at playhead</Text>
                </Pressable>
                <Pressable
                  onPress={() => set({ trimOut: clampOut(position, settings.trimIn, duration) })}
                  style={s.ghost}
                >
                  <Text style={s.ghostText}>Set out</Text>
                </Pressable>
              </View>
              <Text style={[type.note, s.note]}>Range only — nothing is written until Export.</Text>
            </View>
          ) : null}

          {tab === "text" ? (
            <View>
              {texts.map((el, i) => {
                const on = el.id === selectedId;
                return (
                  <View key={el.id} style={[s.textRow, on && s.textRowOn]}>
                    <Pressable onPress={() => setSelectedId(el.id)} hitSlop={8}>
                      <Text style={[s.textIndex, on && s.textIndexOn]}>{i + 1}</Text>
                    </Pressable>
                    <TextInput
                      value={el.text}
                      onFocus={() => setSelectedId(el.id)}
                      onChangeText={(text) => patchText(el.id, { text })}
                      placeholder="Text to burn in"
                      placeholderTextColor={c.w38}
                      style={s.textField}
                    />
                    <Pressable onPress={() => removeText(el.id)} hitSlop={8}>
                      <Text style={s.removeLabel}>REMOVE</Text>
                    </Pressable>
                  </View>
                );
              })}

              <Pressable onPress={addText} style={s.addRow}>
                <Text style={s.addLabel}>{texts.length ? "+ ADD ANOTHER" : "+ ADD TEXT"}</Text>
              </Pressable>

              {selected ? (
                <>
                  <View style={s.inlineRow}>
                    <Text style={type.control}>Size</Text>
                    <View style={s.sizeRow}>
                      <Text style={s.dbText}>{textFontPx(selected, frameH)} px</Text>
                      {(Object.keys(TEXT_SIZE_PRESETS) as TextSizePreset[]).map((key) => {
                        const on = Math.abs(selected.size - TEXT_SIZE_PRESETS[key]) < 0.001;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => patchText(selected.id, { size: TEXT_SIZE_PRESETS[key] })}
                            style={[s.sizeBox, on && s.sizeBoxOn]}
                          >
                            <Text style={[s.sizeText, on && s.sizeTextOn]}>{key}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  {/* Continuous between the presets — the boxes are just three landmarks. */}
                  <Bar
                    value={(selected.size - TEXT_SIZE_MIN) / (TEXT_SIZE_MAX - TEXT_SIZE_MIN)}
                    onChange={(v) =>
                      patchText(selected.id, {
                        size: TEXT_SIZE_MIN + v * (TEXT_SIZE_MAX - TEXT_SIZE_MIN),
                      })
                    }
                    tint={c.accent}
                  />

                  <View style={s.inlineRow}>
                    <Text style={type.control}>Colour</Text>
                    <View style={s.swatchRow}>
                      {TEXT_COLORS.map((hex) => {
                        const on = selected.color === hex;
                        return (
                          <Pressable key={hex} onPress={() => patchText(selected.id, { color: hex })}>
                            <View
                              style={[
                                s.swatch,
                                { backgroundColor: hex },
                                hex === "#111111" && s.swatchDark,
                                on && s.swatchOn,
                              ]}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              ) : null}

              <Text style={[type.note, s.note]}>
                {texts.length
                  ? selected
                    ? "Drag the dashed box on the preview to place it. Burned in at export — not a live layer on the saved file."
                    : "Tap an element to edit its size and colour, or drag it on the preview."
                  : "No text yet. Add one, then drag it on the preview to place it."}
              </Text>
            </View>
          ) : null}

          {tab === "audio" ? (
            <View>
              {MUSIC_TRACKS.map((track: MusicTrack) => {
                const on = settings.music && settings.musicTrackId === track.id;
                return (
                  <Pressable
                    key={track.id}
                    // Tapping the bed that is already mixed in turns music off — the row is
                    // both the picker and the toggle, so there is no separate "none" entry.
                    onPress={() =>
                      set(
                        on
                          ? { music: false }
                          : { music: true, musicTrackId: track.id }
                      )
                    }
                    style={[s.trackRow, on && s.trackRowOn]}
                  >
                    <View style={s.wave}>
                      {track.wave.map((h, i) => (
                        <View
                          key={i}
                          style={[
                            s.waveBar,
                            { height: `${h}%` },
                            on && { backgroundColor: c.accent },
                          ]}
                        />
                      ))}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.body}>{track.name}</Text>
                      <Text style={s.trackMeta}>
                        {clock(track.seconds)} · {track.blurb} · {fitLabel(track, length)}
                      </Text>
                    </View>
                    <Text style={[type.badge, { color: on ? c.success : c.w35 }]}>
                      {on ? "MIXED IN" : "OFF"}
                    </Text>
                  </Pressable>
                );
              })}

              <View style={s.inlineRow}>
                <Text style={type.control}>Track level</Text>
                <Text style={s.dbText}>{settings.musicGainDb} dB</Text>
              </View>
              <Bar
                value={(settings.musicGainDb + 40) / 40}
                onChange={(v: number) => set({ musicGainDb: Math.round(v * 40 - 40) })}
                tint={c.accent}
              />

              <View style={[s.inlineRow, { marginTop: 16 }]}>
                <Text style={type.control}>Original video audio</Text>
                <Text style={s.dbText}>
                  {settings.originalGainDb <= MUTE_DB ? "MUTED" : `${settings.originalGainDb} dB`}
                </Text>
              </View>
              <Bar
                value={(settings.originalGainDb + 40) / 40}
                onChange={(v: number) => set({ originalGainDb: Math.round(v * 40 - 40) })}
                tint={c.w55}
              />

              <Text style={[type.note, s.note]}>
                Mixed in the same pass as trim + text. A bed shorter than the cut loops; a
                longer one is trimmed. All the way down on the original means silence, not a
                quiet track.
              </Text>
              <Text style={[type.note, s.credit]}>{MUSIC_CREDIT}</Text>
            </View>
          ) : null}

          {/*
            Title and description. Edited here rather than only on the publish screen so the
            clip has a name while you are still working on it — and so Post starts filled in
            instead of asking again for something already decided.

            Nothing is sent from this tab. These live in the staged edit and travel to Post;
            the source file keeps its own filename either way.
          */}
          {tab === "info" ? (
            <View style={s.infoPanel}>
              <View style={s.infoField}>
                <Text style={type.label}>TITLE</Text>
                <TextInput
                  value={settings.title}
                  onChangeText={(v) => set({ title: v })}
                  placeholder="Give it a name"
                  placeholderTextColor={c.w38}
                  maxLength={200}
                  style={s.infoInput}
                  accessibilityLabel="Clip title"
                />
              </View>

              <View style={s.infoField}>
                <Text style={type.label}>DESCRIPTION</Text>
                <TextInput
                  value={settings.description}
                  onChangeText={(v) => set({ description: v })}
                  placeholder="Optional"
                  placeholderTextColor={c.w38}
                  multiline
                  maxLength={2000}
                  style={[s.infoInput, s.infoMultiline]}
                  accessibilityLabel="Clip description"
                />
              </View>

              <Text style={[type.note, s.note]}>
                Carried to the post screen when you export. Nothing is uploaded from here.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  infoPanel: { gap: 14 },
  infoField: { gap: 6 },
  infoInput: {
    fontFamily: font.sans,
    fontSize: 13,
    color: c.text,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w14,
  },
  infoMultiline: { minHeight: 88, textAlignVertical: "top" },
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: font.sans, fontSize: 14, fontWeight: "600", color: c.text },
  exportLink: { fontFamily: font.sans, fontSize: 15, fontWeight: "600", color: c.accent },

  // The group must carry flex, not just pass through: `panel` below is `flex: 1` and expects
  // to fill whatever height is left. Wrapping it in a view with no flex sized the wrapper to
  // its content instead, which collapsed the panel to nothing and emptied every tab.
  tools: { flex: 1 },
  toolsHidden: { display: "none" },

  preview: {
    aspectRatio: 16 / 9,
    backgroundColor: c.placeholder,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.w07,
    position: "relative",
  },
  // Expanded: the aspect ratio is dropped so the picture takes whatever height is left.
  // contentFit="contain" keeps it undistorted, letterboxing instead of stretching.
  previewExpanded: { flex: 1, aspectRatio: undefined },
  sizeChip: {
    position: "absolute",
    right: 12,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sizeChipText: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 0.5, color: c.w60 },
  previewMeta: {
    position: "absolute",
    left: 12,
    top: 10,
    fontFamily: font.mono,
    fontSize: 9.5,
    color: c.w30,
  },
  // The caption ghost. Geometry (position, font size, padding) is computed at render time
  // from the element's normalised values — nothing about it is hard-coded here.
  caption: {
    position: "absolute",
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  captionSelected: { borderStyle: "dashed", borderColor: c.accent },
  captionIdle: { borderStyle: "dashed", borderColor: c.w22 },
  captionText: { fontFamily: font.sans, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  playButton: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 99,
    backgroundColor: c.scrimSoft,
    borderWidth: 1,
    borderColor: c.w22,
    alignItems: "center",
    justifyContent: "center",
  },
  playLabel: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", letterSpacing: 0.57, color: "#fff" },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 11,
  },

  stripWrap: { paddingHorizontal: 18, paddingBottom: 14 },
  strip: { height: 56, borderRadius: 8, overflow: "hidden", position: "relative" },
  stripRow: { flexDirection: "row", gap: 2, height: "100%" },
  frame: { flex: 1, height: "100%" },
  frameEmpty: { backgroundColor: c.frameCell },
  scrim: { position: "absolute", top: 0, bottom: 0, backgroundColor: c.scrim },
  selection: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: c.accent,
    borderRadius: 6,
  },
  // The finger target: 28pt wide, centred on the boundary. Transparent, so the strip
  // still looks like the design while being draggable.
  handleHit: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 28,
    marginLeft: -14,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 12,
    height: "100%",
    borderRadius: 6,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  handleActive: { backgroundColor: c.accentSoft },
  handleGrip: { width: 2, height: 16, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.8)" },
  // Extraction progress, drawn along the bottom edge of the strip.
  stripProgress: { position: "absolute", left: 0, bottom: 0, height: 2, backgroundColor: c.accent },
  playhead: { position: "absolute", top: -3, bottom: -3, width: 2, backgroundColor: c.text },
  stripLegend: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  legendText: { fontFamily: font.mono, fontSize: 9.5, color: c.w32 },

  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 18, paddingBottom: 14 },
  tab: { flex: 1, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontFamily: font.sans, fontSize: 12, fontWeight: "600", letterSpacing: 0.36 },

  panel: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: isIOS ? 26 : 14,
    borderRadius: 14,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.w07,
    padding: 16,
  },

  cardRow: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w06,
  },
  cardAccent: { backgroundColor: c.accentBg, borderColor: c.accentBorderSoft },
  cardValue: { marginTop: 4, fontFamily: font.mono, fontSize: 15, fontWeight: "500", color: c.text },

  ghostRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  ghost: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.w16,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontFamily: font.sans, fontSize: 12.5, fontWeight: "500", color: c.textButton },
  note: { marginTop: 14 },

  textRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 4,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w14,
  },
  textRowOn: { borderColor: c.accentBorder },
  textIndex: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", color: c.w38 },
  textIndexOn: { color: c.accentSoft },
  textField: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: font.sans,
    fontSize: 14,
    color: c.text,
  },
  removeLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: 0.6, color: c.w38 },
  addRow: {
    height: 36,
    borderRadius: isIOS ? 8 : 99,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.w14,
    alignItems: "center",
    justifyContent: "center",
  },
  addLabel: { fontFamily: font.mono, fontSize: 10.5, letterSpacing: 0.6, color: c.w60 },

  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  sizeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sizeBox: {
    width: 38,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.w14,
    alignItems: "center",
    justifyContent: "center",
  },
  sizeBoxOn: { backgroundColor: c.w12, borderColor: "transparent" },
  sizeText: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", color: c.w60 },
  sizeTextOn: { fontWeight: "600", color: c.text },

  swatchRow: { flexDirection: "row", gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 99 },
  swatchDark: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  swatchOn: { borderWidth: 2, borderColor: c.accent },

  credit: { marginTop: 6, color: c.w35 },

  trackRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w06,
  },
  trackRowOn: { borderColor: c.accentBorder, backgroundColor: c.accentBgFaint },
  wave: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 22 },
  waveBar: { width: 2, backgroundColor: c.w30 },
  trackMeta: { marginTop: 3, fontFamily: font.mono, fontSize: 10, color: c.w38 },
  dbText: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", color: c.w50 },

  barTrack: {
    marginTop: 8,
    height: 4,
    borderRadius: 99,
    backgroundColor: c.w10,
    justifyContent: "center",
  },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 99 },
  barKnob: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 99,
    backgroundColor: "#fff",
    marginLeft: -8,
  },
}));
