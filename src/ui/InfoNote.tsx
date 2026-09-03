// A circled "i" that reveals an explanation, instead of printing it permanently.
//
// The panels had grown three and four lines of prose each — true, and worth saying once,
// but read once and then in the way for the rest of the session. Behind a button the
// explanation is still there for whoever needs it and gone for whoever does not.
//
// The disclosure is the whole point, so it says what it is next to the icon: an unlabelled
// glyph is a thing people press to find out what it does, which is a worse first read than
// two words.
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { font, themedStyles, useTheme } from "../theme";

export default function InfoNote({
  label,
  children,
}: {
  /** What the note is about, in two or three words. */
  label: string;
  children: string;
}) {
  const { type } = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <Animated.View layout={LinearTransition.duration(200)} style={s.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={s.row}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={open ? "Hides the explanation" : "Shows the explanation"}
        accessibilityState={{ expanded: open }}
      >
        <View style={[s.badge, open && s.badgeOn]}>
          <Text style={[s.badgeText, open && s.badgeTextOn]}>i</Text>
        </View>
        <Text style={[s.label, open && s.labelOn]}>{label}</Text>
      </Pressable>

      {open ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(90)}>
          <Text style={[type.note, s.body]}>{children}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  wrap: { marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  badge: {
    width: 16,
    height: 16,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: c.w30,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeOn: { borderColor: c.accent, backgroundColor: c.accentBgStrong },
  // Serif-ish weight on a 10pt glyph reads as an icon rather than as a stray letter.
  badgeText: { fontFamily: font.sans, fontSize: 10, fontWeight: "700", color: c.w45, lineHeight: 13 },
  badgeTextOn: { color: c.accentSoft },
  label: { fontFamily: font.mono, fontSize: 9.5, letterSpacing: 0.5, color: c.w42 },
  labelOn: { color: c.accentSoft },
  body: { marginTop: 7 },
}));
