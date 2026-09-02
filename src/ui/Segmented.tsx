// The in-page section switch: VIDEOS / LIKED / DRAFTS on the profile.
//
// One API, two presentations, because the design draws them differently on purpose — iOS
// gets a row of filled pills, Android the Material underline. That split is the same one
// the theme already makes for buttons and titles.
import { View, Text, Pressable } from "react-native";
import { font, isIOS, themedStyles, useTheme } from "../theme";

export type Segment<K extends string> = {
  key: K;
  label: string;
  /** Shown after the label. Omit for a segment that has nothing to count. */
  count?: number;
};

export default function Segmented<K extends string>({
  segments,
  value,
  onChange,
}: {
  segments: readonly Segment<K>[];
  value: K;
  onChange: (next: K) => void;
}) {
  const { c, tabState } = useTheme();
  const s = useStyles();

  return (
    <View style={s.row}>
      {segments.map((seg) => {
        const active = seg.key === value;
        const state = tabState(active);
        const text = seg.count === undefined ? seg.label : `${seg.label} ${seg.count}`;

        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            style={[
              s.item,
              isIOS
                ? { backgroundColor: state.backgroundColor }
                : { borderBottomColor: active ? c.accent : "transparent" },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={text}
          >
            <Text style={[s.label, { color: isIOS ? state.color : active ? c.accent : c.w50 }]}>
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  row: isIOS
    ? { flexDirection: "row", gap: 6 }
    : { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.w08 },
  item: isIOS
    ? { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" }
    : {
        flex: 1,
        paddingTop: 12,
        paddingBottom: 10,
        alignItems: "center",
        // Sits on the row's hairline, so the active segment's rule covers it rather than
        // stacking a second line beneath.
        borderBottomWidth: 2,
        marginBottom: -1,
      },
  label: isIOS
    ? { fontFamily: font.sans, fontSize: 11.5, fontWeight: "600", letterSpacing: 11.5 * 0.03 }
    : { fontFamily: font.sans, fontSize: 12, fontWeight: "500", letterSpacing: 12 * 0.07 },
}));
