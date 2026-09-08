// The three-up count block in the profile header.
//
// Platform split again, and again from the design: iOS joins the cells into one rounded
// slab separated by hairlines, Android keeps them as three separate cards. Both are built
// from the same cells — only the gap and where the radius lives differ.
import { View, Text } from "react-native";
import { isIOS, themedStyles, useTheme } from "../theme";

export type Stat = {
  label: string;
  /** Already formatted — the caller decides between a raw count and compactCount(). */
  value: string;
};

export default function StatGrid({ stats }: { stats: readonly Stat[] }) {
  const { type } = useTheme();
  const s = useStyles();

  return (
    <View style={s.grid}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={s.cell}
          accessibilityLabel={`${stat.value} ${stat.label.toLowerCase()}`}
        >
          <Text style={type.statValue}>{stat.value}</Text>
          {/* One line, always. The grid went from three cells to four when FOLLOWING moved
              in, and a label that wraps would make one cell taller than its neighbours. */}
          <Text style={[type.label, s.cellLabel]} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  grid: isIOS
    ? {
        flexDirection: "row",
        // The 1pt gap over the ramp colour IS the separator — no borders to line up.
        gap: 1,
        backgroundColor: c.w07,
        borderRadius: 12,
        overflow: "hidden",
      }
    : { flexDirection: "row", gap: 10 },
  cell: {
    flex: 1,
    backgroundColor: c.panel,
    paddingVertical: 13,
    paddingHorizontal: 4,
    alignItems: "center",
    borderRadius: isIOS ? 0 : 12,
  },
  cellLabel: { marginTop: 3 },
}));
