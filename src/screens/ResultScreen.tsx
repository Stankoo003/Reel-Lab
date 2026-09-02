// Design 1e — Result: verify the output and share.
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Share } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Asset as MediaAsset, requestPermissionsAsync } from "expo-media-library";
import { File } from "expo-file-system";
import { button, font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import { errorMessage } from "../errors";
import { probe } from "../ffmpeg";
import { toPath } from "../assets";
import { checkTrim, describeTrimCheck } from "../trim";
import type { EditSettings, ExportSuccess } from "../types";

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  const { type } = useTheme();
  const s = useStyles();

  return (
    <View style={s.stat}>
      <Text style={type.label}>{label}</Text>
      <Text style={[s.statValue, tint && { color: tint }]}>{value}</Text>
    </View>
  );
}

type Meta = { duration: string; size: string; resolution: string };

export default function ResultScreen({
  result,
  settings,
  onPost,
  onDone,
}: {
  result: ExportSuccess;
  settings: EditSettings | null;
  onPost: () => void;
  onDone: () => void;
}) {
  const { c, type } = useTheme();
  const s = useStyles();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const player = useVideoPlayer(result.out, (p) => (p.loop = true));
  // Subscribed, not read off the player in render — see usePlayerPlaying.
  const playing = usePlayerPlaying(player);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await probe(toPath(result.out));
        const v = info?.streams?.find((x) => x.codec_type === "video");
        const file = new File(result.out);
        if (!alive) return;
        setMeta({
          duration: Number(info?.format?.duration ?? 0).toFixed(2),
          size: ((file.size ?? 0) / 1e6).toFixed(1),
          resolution: v ? `${v.width}×${v.height}` : "—",
        });
      } catch {
        // stats are a nicety — the preview and the actions still work without them
      }
    })();
    return () => {
      alive = false;
    };
  }, [result.out]);

  async function saveToLibrary() {
    try {
      // Class-based API — saveToLibraryAsync() is deprecated in SDK 57.
      //
      // writeOnly only makes sense on iOS, where it maps to the minimal add-only
      // Photos permission. On Android 13+ it asks for WRITE_EXTERNAL_STORAGE, which
      // is no longer grantable, so the request is denied outright; the grantable
      // permissions there are the granular READ_MEDIA_* ones.
      // ['video'] — without it Android also prompts for music and images access.
      const perm = await requestPermissionsAsync(isIOS, ["video"]);
      if (!perm.granted) return setSaved("permission denied");
      await MediaAsset.create(result.out);
      setSaved("saved to library");
    } catch (e) {
      setSaved(errorMessage(e));
    }
  }

  // Prefer the check the export pass already made; fall back to the duration this
  // screen probed, so the criterion is still measured if the result carries no check.
  const trimCheck =
    result.trim ??
    (meta && settings ? checkTrim(settings.trimOut - settings.trimIn, Number(meta.duration)) : null);

  return (
    <View style={s.root}>
      <View style={s.header}>
        {isIOS ? (
          <>
            <Pressable onPress={onDone} hitSlop={10}>
              <Text style={type.action}>Done</Text>
            </Pressable>
            <Text style={s.headerTitle}>Export complete</Text>
            <View style={{ width: 36 }} />
          </>
        ) : (
          <>
            <Pressable onPress={onDone} hitSlop={10}>
              <Text style={s.close}>✕</Text>
            </Pressable>
            <Text style={s.headerTitleAndroid}>Export complete</Text>
          </>
        )}
      </View>

      <View style={s.preview}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />
        <Pressable
          onPress={() => (playing ? player.pause() : player.play())}
          style={s.playButton}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause preview" : "Play preview"}
        >
          <Text style={s.playLabel}>{playing ? "PAUSE" : "PLAY"}</Text>
        </Pressable>
      </View>

      <View style={s.statGrid}>
        <Stat label="DURATION" value={meta ? `${meta.duration}s` : "…"} />
        <Stat label="FILE SIZE" value={meta ? `${meta.size} MB` : "…"} />
        <Stat label="RESOLUTION" value={meta?.resolution ?? "…"} />
        <Stat label="PASS TIME" value={`${(result.ms / 1000).toFixed(1)}s`} tint={c.accentSoft} />
      </View>

      <View style={s.note}>
        <Text style={[type.note, { color: c.w42 }]}>
          1 encode · 0 intermediate files. Measured on this device, this run.
        </Text>
        {/* The trim acceptance check, read off the file rather than assumed. */}
        <Text style={[type.note, { color: trimCheck ? (trimCheck.ok ? c.success : c.recText) : c.w42 }]}>
          {trimCheck
            ? `trim ${trimCheck.ok ? "OK" : "MISMATCH"} · ${describeTrimCheck(trimCheck)}`
            : "trim check · duration unavailable"}
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <View style={s.footer}>
        {saved ? <Text style={[type.note, s.savedNote]}>{saved}</Text> : null}
        <Pressable onPress={onPost} style={s.primary}>
          <Text style={[button.labelStyle, { color: "#fff" }]}>{button.label("Post")}</Text>
        </Pressable>
        <Pressable
          onPress={() => Share.share({ url: result.out, message: "ReelLab export" })}
          style={s.secondary}
        >
          <Text style={[button.labelStyle, { color: c.textButton }]}>{button.label("Share")}</Text>
        </Pressable>
        <Pressable onPress={saveToLibrary} style={s.secondary}>
          <Text style={[button.labelStyle, { color: c.textButton }]}>
            {button.label(isIOS ? "Save to Photos" : "Save to gallery")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: isIOS ? "space-between" : "flex-start",
    gap: isIOS ? 0 : 14,
    paddingHorizontal: 18,
    paddingTop: isIOS ? 6 : 14,
    paddingBottom: isIOS ? 14 : 12,
  },
  headerTitle: { fontFamily: font.sans, fontSize: 14, fontWeight: "600", color: c.text },
  headerTitleAndroid: { flex: 1, fontFamily: font.sans, fontSize: 17, fontWeight: "500", color: c.text },
  close: { fontFamily: font.sans, fontSize: 18, color: c.w60 },

  preview: {
    aspectRatio: 16 / 9,
    backgroundColor: c.placeholder,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.w07,
  },
  playButton: {
    position: "absolute",
    alignSelf: "center",
    top: "44%",
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

  statGrid: {
    margin: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: isIOS ? 1 : 10,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: isIOS ? c.w07 : "transparent",
  },
  stat: {
    width: isIOS ? "49.9%" : "47%",
    backgroundColor: c.panel,
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderRadius: isIOS ? 0 : 12,
  },
  statValue: { marginTop: 5, fontFamily: font.mono, fontSize: 15, fontWeight: "500", color: c.text },

  note: {
    marginHorizontal: 18,
    paddingHorizontal: isIOS ? 14 : 0,
    paddingVertical: isIOS ? 13 : 0,
    borderRadius: 10,
    backgroundColor: isIOS ? c.note : "transparent",
    borderWidth: isIOS ? 1 : 0,
    borderColor: c.w06,
  },

  footer: { paddingHorizontal: 18, paddingBottom: isIOS ? 28 : 20, gap: 10 },
  savedNote: { color: c.success, textAlign: "center" },
  primary: {
    height: button.height,
    borderRadius: button.radius,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    height: button.height,
    borderRadius: button.radius,
    borderWidth: 1,
    borderColor: c.w18,
    alignItems: "center",
    justifyContent: "center",
  },
}));
