// The panel every settings-ish block sits in.
//
// Was declared identically in profile.tsx and ProfileCard.tsx, and approximately in three
// more places.
import { View, Text } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { font, themedStyles } from "../theme";

export default function Card({
  title,
  /** Rendered on the title's row, right-aligned — a status pill, a count, a link. */
  accessory,
  children,
  style,
}: {
  title?: string;
  accessory?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();

  return (
    <View style={[s.card, style]}>
      {title ? (
        <View style={s.head}>
          <Text style={s.title}>{title}</Text>
          {accessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  card: {
    borderRadius: 14,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.w07,
    padding: 16,
    gap: 10,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: font.sans, fontSize: 13, fontWeight: "600", color: c.text },
}));
