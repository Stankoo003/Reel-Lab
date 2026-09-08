// Watch a clip that was shared into a conversation.
//
// A sheet over the thread rather than a jump to the feed: the feed is a stream that would
// have to be scrolled to the clip, and coming back would lose the place in the chat. This
// plays the one clip and closes.
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import type { SharedVideo } from "../../api/client";

export default function VideoPreview({
  video,
  onClose,
}: {
  video: SharedVideo;
  onClose: () => void;
}) {
  const { type } = useTheme();
  const s = useStyles();
  // Autoplays: the sheet exists to play the clip, and opening it onto a still frame would
  // need a second press to do the one thing it is for.
  const player = useVideoPlayer(video.manifestUrl ?? "", (p) => {
    p.loop = true;
    p.play();
  });
  const playing = usePlayerPlaying(player);
  const owner = video.owner?.displayName ?? video.owner?.username;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      statusBarTranslucent={false}
    >
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={type.action}>{isIOS ? "Done" : "✕"}</Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1}>
            {video.title ?? "Video"}
          </Text>
          <View style={s.headerSpacer} />
        </View>

        <Pressable
          style={s.stage}
          onPress={() => (playing ? player.pause() : player.play())}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />
          {playing ? null : (
            <View style={s.playBadge}>
              <Text style={s.playLabel}>PLAY</Text>
            </View>
          )}
        </Pressable>

        {owner ? <Text style={[type.note, s.owner]}>by {owner}</Text> : null}
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: isIOS ? 6 : 14,
    paddingBottom: 12,
  },
  title: { flex: 1, textAlign: "center", fontFamily: font.sans, fontSize: 15, fontWeight: "600", color: c.text },
  headerSpacer: { width: 40 },
  stage: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  playBadge: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  playLabel: { fontFamily: font.mono, fontSize: 12, fontWeight: "700", letterSpacing: 1, color: "#FFF" },
  owner: { paddingHorizontal: 18, paddingVertical: 12 },
}));
