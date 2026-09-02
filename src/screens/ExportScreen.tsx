// Design 1d — Export: one pass, full-screen progress.
import { View, Text, Pressable } from "react-native";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { timecode } from "../clips";
import { musicTrack } from "../assets";
import type { Clip, EditSettings } from "../types";

function Op({ label, state, done }: { label: string; state: string; done: boolean }) {
  const { c, type } = useTheme();
  const s = useStyles();

  const body = (
    <>
      <Text style={[type.bodyMuted, !done && { color: c.w45 }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.badge, { color: done ? c.success : c.w35 }]}>{state}</Text>
    </>
  );
  return isIOS ? (
    <View style={s.opRowIOS}>{body}</View>
  ) : (
    <View style={[s.opRowAndroid, !done && s.opRowAndroidIdle]}>{body}</View>
  );
}

export default function ExportScreen({
  clip,
  settings,
  progress,
  elapsed,
  onCancel,
}: {
  clip: Clip;
  settings: EditSettings;
  /** Encode progress, 0…1. */
  progress: number;
  /** Seconds since the export started. */
  elapsed: number;
  onCancel: () => void;
}) {
  const { type } = useTheme();
  const s = useStyles();
  const pct = Math.round(progress * 100);
  const length = Math.max(0, settings.trimOut - settings.trimIn);
  const est = progress > 0.02 ? elapsed / progress : null;

  const ops: { label: string; done: boolean; state?: string }[] = [
    { label: `Trim ${timecode(settings.trimIn)} → ${timecode(settings.trimOut)}`, done: true },
    { label: "Text overlay burn-in", done: !!settings.text?.trim() },
    {
      label: `Audio mix · ${musicTrack(settings.musicTrackId).name}`,
      done: !!settings.music,
    },
    { label: "Write output file", done: false, state: "QUEUED" },
  ];

  return (
    <View style={s.root}>
      <Text style={s.eyebrow}>Exporting {clip.name}</Text>

      <View style={s.body}>
        <Text style={s.pct}>
          {pct}
          <Text style={s.pctSign}>%</Text>
        </Text>

        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${pct}%` }]} />
        </View>

        <View style={s.progressMeta}>
          <Text style={type.meta}>elapsed {elapsed.toFixed(1)}s</Text>
          <Text style={type.meta}>{est ? `est. ${est.toFixed(1)}s total` : `${length.toFixed(2)}s clip`}</Text>
        </View>

        <View style={s.ops}>
          {ops.map((op) => (
            <Op
              key={op.label}
              label={op.label}
              done={op.done}
              state={op.state ?? (op.done ? "IN PASS" : "SKIPPED")}
            />
          ))}
        </View>

        {isIOS ? (
          <View style={s.callout}>
            <Text style={s.calloutText}>
              Single encode pass. Trim, text and audio are composed before encoding, so the
              video is not re-encoded per operation.
            </Text>
          </View>
        ) : (
          <Text style={[type.note, s.androidNote]}>
            Single encode pass — trim, text and audio are composed before encoding.
          </Text>
        )}
      </View>

      <View style={s.footer}>
        <Pressable onPress={onCancel} style={s.cancel}>
          <Text style={s.cancelText}>{isIOS ? "Cancel export" : "CANCEL"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  eyebrow: {
    paddingHorizontal: isIOS ? 26 : 20,
    paddingTop: isIOS ? 24 : 18,
    fontFamily: font.sans,
    fontSize: isIOS ? 13 : 14,
    fontWeight: isIOS ? "600" : "500",
    color: c.w55,
  },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: isIOS ? 26 : 20 },
  pct: {
    fontFamily: font.mono,
    fontSize: 72,
    fontWeight: "500",
    letterSpacing: -2.16,
    color: c.text,
  },
  pctSign: { fontSize: 30, color: c.w45 },
  progressTrack: {
    marginTop: 22,
    height: isIOS ? 5 : 4,
    borderRadius: 99,
    backgroundColor: isIOS ? c.w10 : c.accentBorderFaint,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 99, backgroundColor: c.accent },
  progressMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },

  ops: {
    marginTop: isIOS ? 34 : 30,
    paddingTop: isIOS ? 18 : 0,
    borderTopWidth: isIOS ? 1 : 0,
    borderTopColor: c.w08,
    gap: isIOS ? 14 : 10,
  },
  opRowIOS: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  opRowAndroid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: c.panel,
  },
  opRowAndroidIdle: { backgroundColor: c.note },

  callout: {
    marginTop: 24,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: c.accentBgFaint,
    borderWidth: 1,
    borderColor: c.accentBorderFaint,
  },
  calloutText: {
    fontFamily: font.mono,
    fontSize: 10.5,
    lineHeight: 16.3,
    color: c.accentNote,
  },
  androidNote: { marginTop: 22 },

  footer: { paddingHorizontal: isIOS ? 26 : 20, paddingBottom: isIOS ? 28 : 20, alignItems: isIOS ? "stretch" : "flex-end" },
  cancel: {
    height: isIOS ? 48 : undefined,
    paddingHorizontal: isIOS ? 0 : 22,
    paddingVertical: isIOS ? 0 : 13,
    borderRadius: isIOS ? 12 : 99,
    borderWidth: 1,
    borderColor: c.w18,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontFamily: font.sans,
    fontSize: isIOS ? 14 : 12.5,
    fontWeight: "500",
    letterSpacing: isIOS ? 0 : 0.75,
    color: c.textButton,
  },
}));
