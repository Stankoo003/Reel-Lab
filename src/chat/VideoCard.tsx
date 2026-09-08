// A shared clip inside a message bubble.
//
// The poster, the title and who made it — enough to know what you are being shown before
// you play it. Tapping opens the preview; the bubble around it keeps the long-press for
// reporting, so the card does not claim that gesture.
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import { font, themedStyles } from "../theme";
import { mmss } from "../clips";
import type { SharedVideo } from "../../api/client";

export default function VideoCard({
  video,
  onOpen,
  trailing,
}: {
  video: SharedVideo;
  onOpen: (video: SharedVideo) => void;
  /** Drawn at the right of the title strip — the sender's ticks live there. */
  trailing?: ReactNode;
}) {
  const s = useStyles();
  const owner = video.owner?.displayName ?? video.owner?.username;
  return (
    <Pressable
      onPress={() => onOpen(video)}
      style={s.card}
      accessibilityRole="button"
      accessibilityLabel={`Play video ${video.title ?? ""}`}
    >
      <View style={s.poster}>
        {video.posterUrl ? (
          <Image
            source={{ uri: video.posterUrl }}
            style={s.posterImage}
            contentFit="cover"
          />
        ) : null}
        <View style={s.playBadge}>
          <Text style={s.playLabel}>PLAY</Text>
        </View>
        {video.durationSeconds ? (
          <Text style={s.duration}>{mmss(video.durationSeconds)}</Text>
        ) : null}
      </View>
      <View style={s.meta}>
        <View style={s.metaText}>
          <Text style={s.title} numberOfLines={2}>
            {video.title ?? "Video"}
          </Text>
          {owner ? (
            <Text style={s.owner} numberOfLines={1}>
              {owner}
            </Text>
          ) : null}
        </View>
        {trailing ? <View style={s.trailing}>{trailing}</View> : null}
      </View>
    </Pressable>
  );
}

/** What a bubble shows when the clip it carried has since been deleted. */
export function VideoGone({ mine }: { mine: boolean }) {
  const s = useStyles();
  return (
    <View style={s.gone}>
      <Text style={[s.goneText, mine && s.goneTextMine]}>
        This video is no longer available.
      </Text>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  // A dark wash over the bubble's own colour: navy on yours, grey on theirs. The strip
  // under the poster is where the title, the author and the sender's ticks sit.
  card: { width: 230, backgroundColor: "rgba(0,0,0,0.5)" },
  // Portrait, like the clips themselves. A landscape box around a vertical video is
  // letterboxing in a chat bubble.
  poster: {
    width: 230,
    height: 290,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  posterImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  playBadge: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  playLabel: {
    fontFamily: font.mono,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#FFF",
  },
  duration: {
    position: "absolute",
    right: 8,
    bottom: 8,
    fontFamily: font.mono,
    fontSize: 10,
    color: "#FFF",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  meta: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  metaText: { flex: 1, minWidth: 0, gap: 2 },
  trailing: { paddingBottom: 1 },
  title: {
    fontFamily: font.sans,
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  owner: {
    fontFamily: font.mono,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.7)",
  },
  gone: { paddingVertical: 2 },
  goneText: {
    fontFamily: font.sans,
    fontSize: 13,
    fontStyle: "italic",
    color: c.w50,
  },
  goneTextMine: { color: "rgba(255,255,255,0.8)" },
}));
