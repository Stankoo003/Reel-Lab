// Design 1a — Camera, record the source clip.
import { useRef, useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import type { CameraType } from "expo-camera";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { errorMessage } from "../errors";

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
      <View style={s.statusRow}>
        <Text style={s.statusText}>FLASH OFF</Text>
        {recording ? (
          <View style={s.recPill}>
            <View style={s.recDot} />
            <Text style={s.recText}>{elapsedLabel(elapsed)}</Text>
          </View>
        ) : (
          <Text style={s.statusText}>READY</Text>
        )}
        <Text style={s.statusText}>1080 · 30</Text>
      </View>

      <View style={s.viewfinder}>
        {ready ? (
          <CameraView
            ref={cam}
            style={StyleSheet.absoluteFill}
            mode="video"
            facing={facing}
            videoQuality="1080p"
          />
        ) : (
          <View style={s.permission}>
            <Text style={[type.note, s.permissionCopy]}>
              camera + microphone permission required
            </Text>
            <View style={s.permissionRow}>
              <Pressable onPress={requestCamera} style={s.ghostSm}>
                <Text style={s.ghostSmText}>
                  Camera {cameraPerm?.granted ? "✓" : ""}
                </Text>
              </Pressable>
              <Pressable onPress={requestMic} style={s.ghostSm}>
                <Text style={s.ghostSmText}>Mic {micPerm?.granted ? "✓" : ""}</Text>
              </Pressable>
            </View>
          </View>
        )}
        <View pointerEvents="none" style={s.viewfinderRule} />
      </View>

      {error ? <Text style={[type.note, s.error]}>{error}</Text> : null}

      <View style={s.controls}>
        <Pressable onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} style={s.side}>
          <Text style={s.sideText}>FLIP</Text>
        </Pressable>

        <Pressable onPress={toggle} disabled={!ready} style={[s.shutter, !ready && s.dim]}>
          <View style={[s.shutterInner, recording && s.shutterInnerRec]} />
        </Pressable>

        <Pressable onPress={onOpenClips} style={[s.side, s.sideRight]}>
          <Text style={[s.sideText, s.sideTextRight]}>CLIPS</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bgCamera },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: isIOS ? 20 : 18,
    paddingTop: isIOS ? 6 : 14,
    paddingBottom: isIOS ? 10 : 14,
  },
  statusText: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.66, color: c.w55 },
  recPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: isIOS ? 8 : 99,
    backgroundColor: c.recBg,
  },
  recDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: c.rec },
  recText: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.66, color: c.recText },

  viewfinder: {
    flex: 1,
    position: "relative",
    backgroundColor: c.placeholder,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  viewfinderRule: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    bottom: 14,
    borderWidth: 1,
    borderColor: c.w08,
    borderRadius: 4,
  },
  permission: { alignItems: "center", gap: 14, paddingHorizontal: 30 },
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
  error: { color: c.recText, paddingHorizontal: 20, paddingVertical: 8 },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: isIOS ? 30 : 26,
    paddingTop: isIOS ? 22 : 24,
    paddingBottom: isIOS ? 24 : 30,
    backgroundColor: isIOS ? "#000000" : "#0A0A0B",
  },
  side: { width: isIOS ? 70 : 74 },
  sideRight: { alignItems: "flex-end" },
  sideText: {
    fontFamily: font.sans,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: isIOS ? 0.44 : 0.99,
    color: c.w70,
  },
  sideTextRight: { textAlign: "right" },
  shutter: {
    width: isIOS ? 74 : 76,
    height: isIOS ? 74 : 76,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: isIOS ? 3 : 0,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: isIOS ? "transparent" : "rgba(255,77,61,0.16)",
  },
  shutterInner: {
    width: isIOS ? 30 : 34,
    height: isIOS ? 30 : 34,
    borderRadius: isIOS ? 6 : 8,
    backgroundColor: c.rec,
  },
  shutterInnerRec: { width: 22, height: 22, borderRadius: 3 },
  dim: { opacity: 0.35 },
}));
