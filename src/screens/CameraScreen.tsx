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
import { View, Text, Pressable, StyleSheet, AppState } from "react-native";
import type { TextStyle } from "react-native";
import { SafeAreaView } from "react-native-screens/experimental";
import { openSettings } from "expo-linking";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import type { CameraType, PermissionResponse } from "expo-camera";
import { button, font, isIOS, themedStyles, useTheme } from "../theme";
import { errorMessage } from "../errors";

const SAFE_EDGES = { top: true, bottom: true } as const;

/**
 * What the viewfinder is allowed to do right now.
 *
 * `expo-camera`'s hooks hand back `null` until the first read resolves, so "we do not know
 * yet" is a real state rather than a synonym for "denied" — rendering the denial copy during
 * that gap is part of what made the old screen feel broken on a cold start.
 *
 * - `checking`  — the permission read has not come back.
 * - `rationale` — never asked. We explain first; the OS dialog comes after a tap.
 * - `denied`    — asked and refused, but `canAskAgain` is still true, so a retry can work.
 * - `blocked`   — `canAskAgain === false`. No prompt will appear again; the only route left
 *                 is the system settings app.
 * - `ready`     — camera and microphone both granted.
 */
type Gate = "checking" | "rationale" | "denied" | "blocked" | "ready";

function gateOf(camera: PermissionResponse | null, mic: PermissionResponse | null): Gate {
  if (!camera || !mic) return "checking";
  if (camera.granted && mic.granted) return "ready";
  // `canAskAgain` only means "permanently denied" once the permission has actually been
  // refused — it is not meaningful while the status is still undetermined.
  const blocked =
    (!camera.granted && camera.status === "denied" && !camera.canAskAgain) ||
    (!mic.granted && mic.status === "denied" && !mic.canAskAgain);
  if (blocked) return "blocked";
  if (camera.status === "undetermined" || mic.status === "undetermined") return "rationale";
  return "denied";
}

/** Which of the two is still missing, in words, for the explanation copy. */
function missingLabel(camera: PermissionResponse | null, mic: PermissionResponse | null): string {
  const missing = [camera?.granted ? null : "camera", mic?.granted ? null : "microphone"].filter(
    Boolean
  );
  return missing.join(" and ") || "camera";
}

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
  const [cameraPerm, requestCamera, getCamera] = useCameraPermissions();
  const [micPerm, requestMic, getMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [recording, setRecording] = useState(false);
  const [asking, setAsking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const gate = gateOf(cameraPerm, micPerm);
  const ready = gate === "ready";

  /**
   * Re-read the permissions when the app comes back to the foreground.
   *
   * The settings route leaves the app, so the grant happens somewhere we cannot observe.
   * Without this the user flips both switches, comes back, and still faces the blocked
   * screen — the classic dead end this whole gate exists to avoid.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void getCamera();
        void getMic();
      }
    });
    return () => sub.remove();
  }, [getCamera, getMic]);

  /**
   * Ask for both, camera first.
   *
   * Sequential rather than parallel: two OS dialogs raced onto the screen at once is
   * undefined behaviour on Android, and the user cannot tell which one they are answering.
   */
  async function askForPermissions() {
    if (asking) return;
    setAsking(true);
    setError(null);
    try {
      await requestCamera();
      // Recording without audio is not a mode this app offers, so ask for the microphone
      // even if the camera was just refused — one round of dialogs rather than two visits.
      // A refusal is not an error: the hooks update, and PermissionGate re-renders with the
      // copy for whichever state we landed in.
      await requestMic();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAsking(false);
    }
  }

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
        <PermissionGate
          gate={gate}
          missing={missingLabel(cameraPerm, micPerm)}
          asking={asking}
          onAsk={askForPermissions}
          onImport={onOpenClips}
          s={s}
          noteStyle={type.note}
        />
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
            {/* The pill is the screen's status line, so it must not claim READY while the
                camera is switched off — that is the reading that made a denied screen look
                merely broken. */}
            <Text style={[s.recText, recording && s.recTextOn]}>
              {recording ? `● ${elapsedLabel(elapsed)}` : ready ? "READY" : "NO CAMERA"}
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

/**
 * What fills the viewfinder when the camera cannot.
 *
 * Three jobs, in the order the design's ink ramp orders them: say what is missing, say why
 * this app wants it, and offer the two things that are still possible — one primary action
 * that moves the permission forward, and Import, which needs no camera permission at all
 * and is the reason this is not a dead end.
 *
 * It occupies the same absolute fill the preview would, so the pills, the readout and the
 * control row keep their positions and the screen never restructures itself around a
 * refusal.
 */
function PermissionGate({
  gate,
  missing,
  asking,
  onAsk,
  onImport,
  s,
  noteStyle,
}: {
  gate: Gate;
  missing: string;
  asking: boolean;
  onAsk: () => void;
  onImport: () => void;
  s: ReturnType<typeof useStyles>;
  noteStyle: TextStyle;
}) {
  if (gate === "checking") {
    return (
      <View style={[StyleSheet.absoluteFill, s.permission]}>
        <Text style={[noteStyle, s.permissionCopy]}>checking permissions…</Text>
      </View>
    );
  }

  const blocked = gate === "blocked";
  const title = blocked
    ? `${missing} access is turned off`
    : gate === "denied"
      ? `ReelLab still needs the ${missing}`
      : "Record with camera and microphone";

  // The rationale, shown BEFORE the OS dialog rather than after it: the system prompt only
  // names the permission, and a user who has not been told what it is for reasonably says no.
  const body = blocked
    ? `The ${missing} permission is switched off for ReelLab and iOS/Android will not ask again from inside the app. Turn it back on in Settings and recording works immediately — nothing you record is uploaded.`
    : `Recording a clip uses the camera for the picture and the microphone for sound. Both stay on this device: clips are saved to ReelLab's own private storage and nothing is uploaded unless you publish it yourself.`;

  return (
    <View style={[StyleSheet.absoluteFill, s.permission]}>
      <View style={s.permissionCard}>
        <Text style={s.permissionTitle}>{title}</Text>
        <Text style={s.permissionBody}>{body}</Text>

        <Pressable
          onPress={blocked ? () => void openSettings() : onAsk}
          disabled={asking}
          style={[s.primary, asking && s.dim]}
          accessibilityRole="button"
          accessibilityState={{ disabled: asking }}
        >
          <Text style={s.primaryLabel}>
            {button.label(blocked ? "Open settings" : asking ? "Waiting…" : "Continue")}
          </Text>
        </Pressable>

        {/* Import needs no camera permission, so it is the honest way out of every state
            above — the screen is never a wall. */}
        <Pressable onPress={onImport} style={s.secondary} accessibilityRole="button">
          <Text style={s.secondaryLabel}>{button.label("Import a video instead")}</Text>
        </Pressable>
      </View>
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

  permission: { alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 26 },
  permissionCopy: { textAlign: "center", color: c.w30, letterSpacing: 0.63 },
  // A card rather than loose text on black: the copy has to compete with the scrims and the
  // floating controls, and the design gives raised explanatory content its own surface.
  permissionCard: {
    width: "100%",
    maxWidth: 340,
    padding: 20,
    borderRadius: isIOS ? 14 : 16,
    backgroundColor: c.sheet,
    borderWidth: 1,
    borderColor: c.w10,
    gap: 12,
  },
  permissionTitle: {
    fontFamily: font.sans,
    fontSize: 16,
    fontWeight: isIOS ? "600" : "500",
    color: c.text,
  },
  permissionBody: {
    fontFamily: font.sans,
    fontSize: 12.5,
    lineHeight: 12.5 * 1.5,
    color: c.w70,
  },
  primary: {
    height: button.height,
    borderRadius: button.radius,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  primaryLabel: { ...button.labelStyle, color: "#FFFFFF" },
  secondary: {
    height: button.compactHeight,
    borderRadius: button.compactRadius,
    borderWidth: 1,
    borderColor: c.w16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { ...button.compactLabelStyle, color: c.textButton },
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
