// Search — the tab exists, the feature does not yet.
//
// Placed in the bar now so the navigation shape is settled before the screen is built:
// adding a tab later shifts every other tab's position, and people build muscle memory for
// where things sit.
//
// Deliberately empty rather than mocked. A fake results grid would be indistinguishable
// from a broken one, and the rest of this app already draws the line at showing values the
// server cannot supply — see the em dashes on the profile.
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";

export default function SearchScreen() {
  const { type } = useTheme();
  const s = useStyles();

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={type.screenTitle}>Search</Text>
      </View>

      <View style={s.body}>
        <View style={s.badge}>
          <Text style={s.badgeText}>NOT BUILT YET</Text>
        </View>
        <Text style={[type.note, s.copy]}>
          Nothing searches anything yet — there is no search endpoint on the server, so this
          screen would have nothing to ask.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 18, paddingTop: isIOS ? 6 : 14, paddingBottom: 12 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: c.w06,
    borderWidth: 1,
    borderColor: c.w12,
  },
  badgeText: { fontFamily: font.mono, fontSize: 9.5, letterSpacing: 0.8, color: c.w50 },
  copy: { textAlign: "center" },
}));
