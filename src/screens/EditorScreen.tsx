// Design 1c — Editor: timeline + trim / text / audio tabs.
// The tabs are not a pipeline: they stage parameters, and Export runs one pass.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image } from "expo-image";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import { timecode } from "../clips";
import { TEXT_COLORS, TEXT_POSITIONS, TEXT_SIZES } from "../export";
import type { TextPositionDef } from "../export";
import type { Clip, EditSettings, TextPosition, TextSize } from "../types";
import type { Dispatch, SetStateAction } from "react";
import type { VideoThumbnail } from "expo-video";

const FRAME_COUNT = 10;

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

      <View style={s.preview}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <Text style={s.previewMeta}>source clip · {clip.durationLabel}</Text>
        {tab === "text" && settings.text?.trim() ? (
          <View style={[s.overlayGhost, TEXT_POSITIONS[settings.textPosition]?.preview]}>
            <Text style={s.overlayGhostText}>{settings.text}</Text>
          </View>
        ) : null}
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
              <TextInput
                value={settings.text}
                onChangeText={(text) => set({ text })}
                placeholder="Text to burn in"
                placeholderTextColor={c.w38}
                style={s.textField}
              />
              <View style={s.segRow}>
                {(Object.entries(TEXT_POSITIONS) as [TextPosition, TextPositionDef][]).map(([key, def]) => {
                  const on = settings.textPosition === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => set({ textPosition: key })}
                      style={[s.seg, on && s.segOn]}
                    >
                      <Text style={[s.segText, on && s.segTextOn]}>{def.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.inlineRow}>
                <Text style={type.control}>Size</Text>
                <View style={s.sizeRow}>
                  {(Object.keys(TEXT_SIZES) as TextSize[]).map((key) => {
                    const on = settings.textSize === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => set({ textSize: key })}
                        style={[s.sizeBox, on && s.sizeBoxOn]}
                      >
                        <Text style={[s.sizeText, on && s.sizeTextOn]}>{key}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={s.inlineRow}>
                <Text style={type.control}>Colour</Text>
                <View style={s.swatchRow}>
                  {TEXT_COLORS.map((hex) => {
                    const on = settings.textColor === hex;
                    return (
                      <Pressable key={hex} onPress={() => set({ textColor: hex })}>
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

              <Text style={[type.note, s.note]}>
                Burned in at export — not a live layer on the saved file.
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
  overlayGhost: {
    position: "absolute",
    alignSelf: "center",
    bottom: 34,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: c.accent,
    borderRadius: 6,
  },
  overlayGhostText: { fontFamily: font.sans, fontSize: 15, fontWeight: "600", color: "#fff" },
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

  textField: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.accentBorder,
    fontFamily: font.sans,
    fontSize: 14,
    color: c.text,
  },
  segRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  seg: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.w14,
    alignItems: "center",
    justifyContent: "center",
  },
  segOn: { backgroundColor: c.accentBgStrong, borderColor: c.accentBorder },
  segText: { fontFamily: font.sans, fontSize: 11.5, fontWeight: "500", color: c.w60 },
  segTextOn: { fontWeight: "600", color: c.accentSoft },

  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  sizeRow: { flexDirection: "row", gap: 6 },
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
