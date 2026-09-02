// One cell of the profile's video grid — design 3a.
//
// Portrait rather than the 16:10 the old My videos tab used: these are vertical clips, and
// a landscape well letterboxes every one of them.
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { compactCount } from "../format";
import type { Clip } from "../types";

export default function VideoTile({
  clip,
  onPress,
}: {
  clip: Clip;
  onPress: (clip: Clip) => void;
}) {
  const { type } = useTheme();
  const s = useStyles();

  return (
    <Pressable
      style={s.cell}
      onPress={() => onPress(clip)}
      accessibilityRole="button"
      accessibilityLabel={clip.name}
    >
      <View style={s.thumb}>
        {clip.thumb ? (
          <Image source={clip.thumb} style={s.thumbImage} contentFit="cover" />
        ) : null}
        <View style={[s.chip, s.chipDuration]}>
          <Text style={type.chip}>{clip.durationLabel}</Text>
        </View>
        {/*
          The design puts a view count here. Nothing on the server counts views yet — no
          field, no endpoint — so the chip renders its shape with an em dash rather than a
          number the app would be inventing.
        */}
        <View style={[s.chip, s.chipViews]}>
          <Text style={type.chip}>— ▸</Text>
        </View>
      </View>

      <Text style={s.name} numberOfLines={1}>
        {clip.name}
      </Text>

      {/*
        Named chips rather than a heart and a speech bubble. The app has no icon library, so
        those were literal emoji — which render as someone else's artwork, change with the OS,
        and read as decoration next to the mono numbers around them. Words match how the feed
        rail already labels the same two things.
      */}
      <View style={s.meta}>
        <View style={s.chipMeta}>
          <Text style={s.chipLabel}>LIKES</Text>
          <Text style={s.chipValue}>{compactCount(clip.likeCount ?? 0)}</Text>
        </View>
        {/* Comment counts are not on VideoResponse — the chip keeps the shape, not a number. */}
        <View style={s.chipMeta}>
          <Text style={s.chipLabel}>COMM</Text>
          <Text style={s.chipValue}>—</Text>
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = themedStyles(({ c }) => ({
  cell: { flex: 1, gap: 6 },
  thumb: {
    aspectRatio: 9 / 13,
    borderRadius: isIOS ? 10 : 12,
    overflow: "hidden",
    // A video well, so it stays dark in both schemes — the theme's placeholder token.
    backgroundColor: c.placeholder,
    borderWidth: 1,
    borderColor: c.w07,
  },
  thumbImage: { width: "100%", height: "100%" },
  chip: {
    position: "absolute",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  chipDuration: { left: 6, bottom: 6 },
  chipViews: { right: 6, top: 6 },
  name: { fontFamily: font.sans, fontSize: 12, fontWeight: "500", color: c.text },
  meta: { flexDirection: "row", gap: 6 },
  chipMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: c.w06,
  },
  chipLabel: { fontFamily: font.mono, fontSize: 8.5, fontWeight: "500", letterSpacing: 0.5, color: c.w42 },
  chipValue: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", color: c.text },
}));
