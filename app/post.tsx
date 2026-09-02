// Post — title, description, publish. Reached from Result, after the export.
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as VideoThumbnails from "expo-video-thumbnails";
import { File } from "expo-file-system";
import { button, font, isIOS, themedStyles, useTheme } from "../src/theme";
import { useClips } from "../src/state/ClipsContext";
import { uploadMedia, createVideo, setVideoPublished } from "../api/client";
import { toPath } from "../src/assets";
import { errorMessage } from "../src/errors";
import { probe } from "../src/ffmpeg";

export default function PostRoute() {
  const router = useRouter();
  const { result, clip } = useClips();
  const { c, type } = useTheme();
  const s = useStyles();

  const [title, setTitle] = useState(clip?.name ?? "");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [poster, setPoster] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [sizeMB, setSizeMB] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poster and duration come from the exported file itself, so they always describe
  // what will actually play rather than the source clip.
  //
  // expo-video-thumbnails, not player.generateThumbnailsAsync: the latter returns a
  // native SharedRef with no way to write it to disk, and multipart upload needs a
  // real file.
  useEffect(() => {
    if (!result?.out) return;
    let alive = true;
    // Read once here rather than in render — File.size is a synchronous native call,
    // and the render path is no place for filesystem I/O.
    try {
      setSizeMB((new File(result.out).size / 1e6).toFixed(1));
    } catch {
      // missing file surfaces at upload with a real message
    }
    (async () => {
      try {
        const meta = await probe(toPath(result.out));
        const seconds = Number(meta?.format?.duration ?? 0);
        if (!alive) return;
        setDuration(seconds);

        const shot = await VideoThumbnails.getThumbnailAsync(result.out, {
          time: Math.round(Math.min(1000, (seconds * 1000) / 3)),
          quality: 0.8,
        });
        if (alive) setPoster(shot.uri);
      } catch {
        // a missing poster is allowed — the server treats it as optional
      }
    })();
    return () => {
      alive = false;
    };
  }, [result?.out]);

  // From an effect, not mid-render — navigation is a side effect.
  const invalid = !result?.out;
  useEffect(() => {
    if (invalid) router.replace("/");
  }, [invalid, router]);

  if (invalid) return null;

  async function publish() {
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    // The render guard below already covers this; the check is only what tells
    // TypeScript that inside this closure.
    if (!result?.out) return;
    setBusy(true);
    setError(null);
    try {
      setStage("Uploading…");
      const media = await uploadMedia(result.out, poster);

      setStage("Creating…");
      const video = await createVideo({
        title: title.trim(),
        description: description.trim() || undefined,
        durationSeconds: Math.max(1, Math.round(duration || 1)),
        manifestPath: media.manifestPath,
        posterPath: media.posterPath,
      });

      if (published) {
        // `id` is optional in the generated schema; without one there is nothing to publish.
        if (!video.id) throw new Error("Create video returned no id");
        setStage("Publishing…");
        await setVideoPublished(video.id, true);
      }

      // Land where the result of the action is visible. A draft is only visible in the
      // profile's DRAFTS segment, which is where My videos moved.
      router.dismissTo(published ? "/(tabs)" : "/(tabs)/profile");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} disabled={busy}>
          <Text style={[type.action, busy && { opacity: 0.4 }]}>Back</Text>
        </Pressable>
        <Text style={s.headerTitle}>New post</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={isIOS ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.row}>
            <View style={s.poster}>
              {poster ? (
                <Image source={{ uri: poster }} style={s.posterImage} contentFit="cover" />
              ) : (
                <ActivityIndicator color={c.w50} />
              )}
            </View>
            <View style={s.rowMeta}>
              <Text style={type.label}>DURATION</Text>
              <Text style={s.rowValue}>{duration ? `${duration.toFixed(2)}s` : "…"}</Text>
              <Text style={[type.label, { marginTop: 10 }]}>SIZE</Text>
              <Text style={s.rowValue}>{sizeMB ? `${sizeMB} MB` : "…"}</Text>
            </View>
          </View>

          <View style={s.field}>
            <Text style={type.label}>TITLE</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Give it a name"
              placeholderTextColor={c.w38}
              maxLength={200}
              style={s.input}
            />
          </View>

          <View style={s.field}>
            <Text style={type.label}>DESCRIPTION</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Optional"
              placeholderTextColor={c.w38}
              multiline
              style={[s.input, s.multiline]}
            />
          </View>

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Publish to feed</Text>
              <Text style={[type.note, { marginTop: 4 }]}>
                {published
                  ? "Visible to everyone in Feed."
                  : "Saved as a draft — only in My videos."}
              </Text>
            </View>
            <Switch
              value={published}
              onValueChange={setPublished}
              trackColor={{ false: c.w16, true: c.accentBgStrong }}
              thumbColor={published ? c.accent : c.w50}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.footer}>
        <Pressable onPress={publish} disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]}>
          {busy ? (
            <View style={s.busyRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={[button.labelStyle, { color: "#fff" }]}>{stage ?? "Working…"}</Text>
            </View>
          ) : (
            <Text style={[button.labelStyle, { color: "#fff" }]}>
              {button.label(published ? "Publish" : "Save draft")}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
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
  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 18 },

  row: { flexDirection: "row", gap: 14 },
  poster: {
    width: 132,
    aspectRatio: 16 / 9,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: c.placeholder,
    borderWidth: 1,
    borderColor: c.w07,
    alignItems: "center",
    justifyContent: "center",
  },
  posterImage: { width: "100%", height: "100%" },
  rowMeta: { flex: 1, justifyContent: "center" },
  rowValue: { marginTop: 4, fontFamily: font.mono, fontSize: 14, fontWeight: "500", color: c.text },

  field: { gap: 6 },
  input: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w14,
    fontFamily: font.sans,
    fontSize: 14,
    color: c.text,
  },
  multiline: { minHeight: 92, textAlignVertical: "top" },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.w07,
  },
  switchLabel: { fontFamily: font.sans, fontSize: 13, fontWeight: "600", color: c.text },

  // Theme tokens, not literals — the hardcoded dark-scheme rgba pair rendered wrong
  // against the light scheme's surfaces.
  error: {
    fontFamily: font.mono,
    fontSize: 10.5,
    lineHeight: 16,
    color: c.recText,
    padding: 12,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
  },

  footer: { paddingHorizontal: 18, paddingBottom: isIOS ? 8 : 16, paddingTop: 8 },
  primary: {
    height: button.height,
    borderRadius: button.radius,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
}));
