// A round avatar that always renders something.
//
// The design draws the fallback as a filled accent disc with the initial in the background
// colour — the same treatment in the profile header (72pt) and in the comment list (36pt),
// so it is one component sized by a prop rather than two that drift.
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { font, themedStyles, useTheme } from "../theme";

/**
 * The comment list tints each avatar so two speakers are told apart at a glance. Derived
 * from the name rather than stored, because there is no colour on the user record — the
 * same name therefore always gets the same tint, which is the property that matters.
 */
const TINTS = ["#4C8DF6", "#57C7A3", "#F2C230", "#FF8A65", "#B388FF", "#4DD0E1"];

export function tintFor(seed: string | null | undefined): string {
  if (!seed) return TINTS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

export default function Avatar({
  uri,
  name,
  size,
  /** Overrides the derived tint — the profile header is always accent. */
  tint,
  busy = false,
}: {
  uri?: string | null;
  name?: string | null;
  size: number;
  tint?: string;
  busy?: boolean;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const round = { width: size, height: size, borderRadius: size / 2 };
  const initial = (name ?? "?").trim().slice(0, 1).toUpperCase() || "?";

  return (
    <View style={[round, s.wrap]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[round, s.image]}
          contentFit="cover"
          accessibilityLabel={`${name ?? "User"}'s avatar`}
        />
      ) : (
        <View
          style={[round, s.fallback, { backgroundColor: tint ?? tintFor(name) }]}
          accessibilityLabel={`${name ?? "User"}'s avatar`}
        >
          {/* On the background colour, not white: the tints are light enough that white
              text on them fails contrast, and the design draws it this way. */}
          <Text style={[s.initial, { fontSize: size * 0.34, color: c.bg }]}>{initial}</Text>
        </View>
      )}
      {busy ? (
        <View style={[StyleSheet.absoluteFill, round, s.busy]}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  wrap: { position: "relative" },
  image: { backgroundColor: c.w06 },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { fontFamily: font.sans, fontWeight: "600" },
  busy: {
    backgroundColor: "rgba(10,10,11,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
}));
