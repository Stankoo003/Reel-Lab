// Design 4a — Camera, cleaner.
//
// Replaces 1a. The viewfinder used to sit in a boxed frame between a status bar and a
// control bar, with a third bar below it for Import; the picture was the smallest part of a
// camera screen. Now the preview runs full bleed and everything else floats on top of it:
// two scrims for legibility, a row of pills at the top, and one control row at the bottom
// that carries Import, the shutter and Flip together.
//
// The chrome sits inside a SafeAreaView from react-native-screens — the same one the feed
// uses — so it clears the floating tab bar without a hardcoded number, while the picture
// behind it still reaches the screen edges.
import { useRef, useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-screens/experimental";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import type { CameraType } from "expo-camera";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { errorMessage } from "../errors";

const SAFE_EDGES = { top: true, bottom: true } as const;

function elapsedLabel(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function CameraScreen({
  onClip,
  onOpenClips,
}: {
  /** A finished recording, as a file:// URI. */
  onClip: (uri: string) => void;
  /** The Import control — opens the gallery picker. */
  onOpenClips: () => void;
}) {
  const { type } = useTheme();
  const s = useStyles();
  const cam = useRef<CameraView>(null);
  const [cameraPerm, requestCamera] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ready = cameraPerm?.granted && micPerm?.granted;

  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function toggle() {
    if (recording) return cam.current?.stopRecording();
    setRecording(true);
    setError(null);
    try {
      const r = await cam.current?.recordAsync({ maxDuration: 60 });
      if (r?.uri) onClip(r.uri);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRecording(false);
    }
  }

  return (
    <View style={s.root}>
      {ready ? (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          mode="video"
          facing={facing}
          videoQuality="1080p"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.permission]}>
          <Text style={[type.note, s.permissionCopy]}>
            camera + microphone permission required
          </Text>
          <View style={s.permissionRow}>
            <Pressable onPress={requestCamera} style={s.ghostSm}>
              <Text style={s.ghostSmText}>Camera {cameraPerm?.granted ? "✓" : ""}</Text>
            </Pressable>
            <Pressable onPress={requestMic} style={s.ghostSm}>
              <Text style={s.ghostSmText}>Mic {micPerm?.granted ? "✓" : ""}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Two scrims, not a flat bar: they keep the mono labels legible over whatever the
          lens happens to be pointing at, without walling the picture off. */}
      <View pointerEvents="none" style={s.scrimTop} />
      <View pointerEvents="none" style={s.scrimBottom} />

      {/* box-none so the gaps between controls stay transparent to touch — the preview
          underneath is what a tap-to-focus would eventually need. */}
      <SafeAreaView pointerEvents="box-none" edges={SAFE_EDGES} style={StyleSheet.absoluteFill}>
        <View pointerEvents="box-none" style={s.topRow}>
          <View style={s.pill}>
            <Text style={s.pillText}>FLASH OFF</Text>
          </View>

          <View style={[s.recPill, recording && s.recPillOn]}>
            <Text style={[s.recText, recording && s.recTextOn]}>
              {recording ? `● ${elapsedLabel(elapsed)}` : "READY"}
            </Text>
          </View>

          {/* No destination yet — the design shows the affordance, the sheet behind it is
              not part of this change. */}
          <View style={s.pill}>
            <Text style={s.pillText}>SETTINGS</Text>
          </View>
        </View>

        <View pointerEvents="box-none" style={s.bottom}>
          {error ? <Text style={s.error}>{error}</Text> : null}

          {/* Directly above the shutter, where the eye already is — it used to sit in the
              top bar, as far from the button it describes as the screen allows. */}
          <Text style={s.readout}>1080 · 30 FPS</Text>

          <View pointerEvents="box-none" style={s.controls}>
            <Pressable onPress={onOpenClips} style={s.sideControl} accessibilityRole="button">
              <View style={s.importThumb} />
              <Text style={s.sideLabel}>IMPORT</Text>
            </Pressable>

            <Pressable
              onPress={toggle}
              disabled={!ready}
              style={[s.shutter, !ready && s.dim]}
              accessibilityRole="button"
              accessibilityLabel={recording ? "Stop recording" : "Start recording"}
              accessibilityState={{ disabled: !ready }}
            >
              <View style={recording ? s.shutterInnerRec : s.shutterInner} />
            </Pressable>

            <Pressable
              onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
              style={s.sideControl}
              accessibilityRole="button"
              accessibilityLabel="Flip camera"
            >
              <View style={s.flipDisc} />
              <Text style={s.sideLabel}>FLIP</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

/*
 * The screen is pinned dark (see app/(tabs)/create.tsx), and every value below sits on top
 * of the picture rather than on a themed surface — so the white alphas are the ink ramp read
 * in its dark direction, which is what the tokens already give here.
 */
const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bgCamera },

  scrimTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: isIOS ? 130 : 110,
    experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
  },
  scrimBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 230,
    experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.72))",
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: isIOS ? 6 : 14,
  },
  pill: {
    paddingHorizontal: isIOS ? 13 : 14,
    paddingVertical: isIOS ? 9 : 10,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  pillText: {
    fontFamily: font.mono,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.85)",
  },
  recPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  // Red only while it is actually recording, so the loudest thing on the screen is also
  // the only state you can lose footage in.
  recPillOn: { backgroundColor: "rgba(255,77,61,0.9)" },
  recText: {
    fontFamily: font.mono,
    fontSize: 11.5,
    fontWeight: "500",
    letterSpacing: 1.15,
    color: "rgba(255,255,255,0.7)",
  },
  recTextOn: { letterSpacing: 0.69, color: "#FFFFFF" },

  bottom: { marginTop: "auto", paddingBottom: isIOS ? 36 : 26 },
  readout: {
    textAlign: "center",
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: "rgba(255,255,255,0.42)",
    marginBottom: 6,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: isIOS ? 34 : 32,
  },
  sideControl: { alignItems: "center", gap: 6 },
  // The design hatches this square to read as a filmstrip. Repeating gradients are not a
  // thing in React Native, so it takes the theme's frame-cell colour instead — the same
  // token the editor's filmstrip uses.
  importThumb: {
    width: isIOS ? 44 : 46,
    height: isIOS ? 44 : 46,
    borderRadius: isIOS ? 10 : 12,
    backgroundColor: c.frameCell,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  flipDisc: {
    width: isIOS ? 44 : 46,
    height: isIOS ? 44 : 46,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  sideLabel: {
    fontFamily: font.mono,
    fontSize: 9.5,
    color: "rgba(255,255,255,0.55)",
  },
  shutter: {
    width: isIOS ? 78 : 80,
    height: isIOS ? 78 : 80,
    borderRadius: 99,
    borderWidth: 3.5,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 60, height: 60, borderRadius: 99, backgroundColor: c.rec },
  // Circle to rounded square: the shape carries "recording" as well as the pill does, for
  // anyone who cannot pick the red out.
  shutterInnerRec: { width: 28, height: 28, borderRadius: 7, backgroundColor: c.rec },
  dim: { opacity: 0.35 },

  permission: { alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 30 },
  permissionCopy: { textAlign: "center", color: c.w30, letterSpacing: 0.63 },
  permissionRow: { flexDirection: "row", gap: 10 },
  ghostSm: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.w16,
  },
  ghostSmText: { fontFamily: font.sans, fontSize: 12, fontWeight: "500", color: c.textButton },
  error: {
    fontFamily: font.mono,
    fontSize: 10.5,
    lineHeight: 16,
    color: c.recText,
    textAlign: "center",
    paddingHorizontal: 24,
    marginBottom: 10,
  },
}));
