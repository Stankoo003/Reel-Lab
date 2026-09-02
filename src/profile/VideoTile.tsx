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

      <View style={s.meta}>
        <Text style={s.metaText}>♥ {compactCount(clip.likeCount ?? 0)}</Text>
        {/* Comment counts are not on VideoResponse either — same reason, same treatment. */}
        <Text style={s.metaText}>💬 —</Text>
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
  meta: { flexDirection: "row", gap: 11 },
  metaText: { fontFamily: font.mono, fontSize: 10, color: c.w42 },
}));
