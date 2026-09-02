// Design 1c — Editor: timeline + trim / text / audio tabs.
// The tabs are not a pipeline: they stage parameters, and Export runs one pass.
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, PanResponder, TextInput, ScrollView, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image } from "expo-image";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import { timecode } from "../clips";
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
import type { Dispatch, SetStateAction } from "react";
import type { VideoThumbnail } from "expo-video";

const FRAME_COUNT = 10;

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

type Tab = "trim" | "text" | "audio";

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
  const [frames, setFrames] = useState<VideoThumbnail[]>([]);
  const [tab, setTab] = useState<Tab>("trim");
  const [position, setPosition] = useState(0);
  const stripWidth = useRef(0);
  const [previewBox, setPreviewBox] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const player = useVideoPlayer(clip.uri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });
  // Subscribed, not read off the player in render — see usePlayerPlaying.
  const playing = usePlayerPlaying(player);

  const duration = clip.duration || 1;

  useEffect(() => {
    const sub = player.addListener("timeUpdate", (e) => setPosition(e.currentTime ?? 0));
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const times = Array.from({ length: FRAME_COUNT }, (_, i) => (duration * i) / FRAME_COUNT);
        const shots = await player.generateThumbnailsAsync(times, { maxWidth: 120 });
        if (alive) setFrames(shots);
      } catch {
        // filmstrip is a nicety — the editor still works without it
      }
    })();
    return () => {
      alive = false;
    };
  }, [player, duration]);

  const set = (patch: Partial<EditSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));

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

  const inPct = (settings.trimIn / duration) * 100;
  const outPct = 100 - (settings.trimOut / duration) * 100;
  const playPct = (position / duration) * 100;
  const length = Math.max(0, settings.trimOut - settings.trimIn);

  function seekFromStrip(x: number) {
    if (!stripWidth.current) return;
    const t = Math.max(0, Math.min(duration, (x / stripWidth.current) * duration));
    player.currentTime = t;
    setPosition(t);
  }

  const tabs: [Tab, string][] = [
    ["trim", "TRIM"],
    ["text", "TEXT"],
    ["audio", "AUDIO"],
  ];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={type.action}>Cancel</Text>
        </Pressable>
        <Text style={s.headerTitle}>{clip.name}</Text>
        <Pressable onPress={onExport} hitSlop={10}>
          <Text style={s.exportLink}>Export</Text>
        </Pressable>
      </View>

      <View
        style={s.preview}
        onLayout={(e) =>
          setPreviewBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <Text style={s.previewMeta}>source clip · {clip.durationLabel}</Text>
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
          onPress={() => (playing ? player.pause() : player.play())}
          style={s.playButton}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause preview" : "Play preview"}
        >
          <Text style={s.playLabel}>{playing ? "PAUSE" : "PLAY"}</Text>
        </Pressable>
      </View>

      <View style={s.timeRow}>
        <Text style={type.meta}>
          <Text style={{ color: c.text }}>{timecode(position)}</Text> / {timecode(duration)}
        </Text>
        <Text style={type.meta}>30 fps</Text>
      </View>

      <View style={s.stripWrap}>
        <Pressable
          style={s.strip}
          onLayout={(e) => (stripWidth.current = e.nativeEvent.layout.width)}
          onPress={(e) => seekFromStrip(e.nativeEvent.locationX)}
        >
          <View style={s.stripRow}>
            {(frames.length ? frames : Array.from({ length: FRAME_COUNT })).map((f, i) =>
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
          <View style={[s.handle, { left: `${inPct}%`, transform: [{ translateX: -6 }] }]}>
            <View style={s.handleGrip} />
          </View>
          <View style={[s.handle, { right: `${outPct}%`, transform: [{ translateX: 6 }] }]}>
            <View style={s.handleGrip} />
          </View>
          <View style={[s.playhead, { left: `${playPct}%` }]} />
        </Pressable>
        <View style={s.stripLegend}>
          <Text style={s.legendText}>00:00</Text>
          <Text style={s.legendText}>tap to scrub · {FRAME_COUNT} frames</Text>
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
                  <Text style={s.cardValue}>{timecode(settings.trimIn)}</Text>
                </View>
                <View style={s.card}>
                  <Text style={type.label}>OUT</Text>
                  <Text style={s.cardValue}>{timecode(settings.trimOut)}</Text>
                </View>
                <View style={[s.card, s.cardAccent]}>
                  <Text style={[type.label, { color: "rgba(76,141,246,0.85)" }]}>LENGTH</Text>
                  <Text style={[s.cardValue, { color: c.accentSoft }]}>{length.toFixed(2)}s</Text>
                </View>
              </View>
              <View style={s.ghostRow}>
                <Pressable
                  onPress={() => set({ trimIn: Math.min(position, settings.trimOut - 0.2) })}
                  style={s.ghost}
                >
                  <Text style={s.ghostText}>Set in at playhead</Text>
                </Pressable>
                <Pressable
                  onPress={() => set({ trimOut: Math.max(position, settings.trimIn + 0.2) })}
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
              <Pressable
                onPress={() => set({ music: !settings.music })}
                style={s.trackRow}
              >
                <View style={s.wave}>
                  {[40, 80, 55, 100, 35, 70].map((h, i) => (
                    <View key={i} style={[s.waveBar, { height: `${h}%` }]} />
                  ))}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>spike-music.m4a</Text>
                  <Text style={s.trackMeta}>0:15 · 44.1 kHz</Text>
                </View>
                <Text
                  style={[
                    type.badge,
                    { color: settings.music ? c.success : c.w35 },
                  ]}
                >
                  {settings.music ? "MIXED IN" : "OFF"}
                </Text>
              </Pressable>

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
                <Text style={s.dbText}>{settings.originalGainDb} dB</Text>
              </View>
              <Bar
                value={(settings.originalGainDb + 40) / 40}
                onChange={(v: number) => set({ originalGainDb: Math.round(v * 40 - 40) })}
                tint={c.w55}
              />

              <Text style={[type.note, s.note]}>Mixed in the same pass as trim + text.</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
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

  preview: {
    aspectRatio: 16 / 9,
    backgroundColor: c.placeholder,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.w07,
    position: "relative",
  },
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
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 12,
    borderRadius: 6,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  handleGrip: { width: 2, height: 16, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.8)" },
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

  trackRow: {
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
