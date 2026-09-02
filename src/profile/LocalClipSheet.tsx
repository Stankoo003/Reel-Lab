// Playback, and the two things you can do with a device-only clip: edit it, or delete it.
//
// Why a sheet rather than a route: tapping a local clip used to go straight to the EDITOR,
// which meant there was no way to simply *watch* what you had recorded — the first thing
// anyone wants from a list of their own videos. Playback is now the default destination and
// editing is one explicit press away from it, so the two are no longer the same gesture.
//
// There is deliberately no comment affordance here, and there cannot be one: a local clip
// has never been uploaded, so there is no server row to attach a comment to and nobody who
// could ever read it. See isServerBacked in src/library.ts — the rule is "no affordance",
// not "an affordance that fails".
import { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, Alert } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../theme";
import { usePlayerPlaying } from "../hooks/usePlayerPlaying";
import { formatBytes } from "../localClips";
import Button from "../ui/Button";
import type { Clip } from "../types";

export default function LocalClipSheet({
  clip,
  onClose,
  onEdit,
  onDelete,
}: {
  clip: Clip;
  onClose: () => void;
  onEdit: (clip: Clip) => void;
  /** Already confirmed by this sheet. Returns whether the file itself was removed. */
  onDelete: (clip: Clip) => boolean;
}) {
  const { c, type } = useTheme();
  const s = useStyles();
  const [note, setNote] = useState<string | null>(null);
  // Autoplays: the sheet exists to play the clip, so opening it and finding a still frame
  // would need a second press to do the one thing it is for.
  const player = useVideoPlayer(clip.uri, (p) => {
    p.loop = true;
    p.play();
  });
  // Subscribed rather than read in render — see usePlayerPlaying.
  const playing = usePlayerPlaying(player);

  function confirmDelete() {
    // Destructive and unrecoverable: this file is the only copy of the clip in existence,
    // so it never goes without an explicit yes.
    Alert.alert(
      "Delete this clip?",
      `"${clip.name}" is saved only on this device. Deleting removes the file for good — there is no copy on the server to restore it from.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            // Stop first: the file is about to disappear from underneath the player.
            try {
              player.pause();
            } catch {
              // already released; the delete is what matters
            }
            const removed = onDelete(clip);
            if (removed) return onClose();
            // The entry is gone either way (see removeClip), but the file was not there to
            // remove — say so rather than implying storage was freed.
            setNote("Removed from the list — the file was already gone.");
          },
        },
      ]
    );
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      // Android ignores presentationStyle; without this the sheet renders on a transparent
      // window and the profile shows through the video.
      statusBarTranslucent={false}
    >
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={type.action}>{isIOS ? "Done" : "✕"}</Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1}>
            {clip.name}
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
          {/* Only while paused: a permanent badge over a playing video is chrome. */}
          {playing ? null : (
            <View style={s.playBadge}>
              <Text style={s.playLabel}>PLAY</Text>
            </View>
          )}
        </Pressable>

        {/*
          The device-only statement, in full words rather than as a chip. The grid's chip
          flags it; this is where the consequence is spelled out, because "saved" and
          "posted" are the two things a user is most likely to confuse.
        */}
        <View style={s.banner}>
          <View style={s.bannerHead}>
            <Text style={s.bannerLabel}>DEVICE ONLY</Text>
            <Text style={s.bannerMeta}>
              {clip.durationLabel} · {formatBytes(clip.bytes)}
            </Text>
          </View>
          <Text style={type.note}>
            This clip is saved in this app on this device. It has not been published, nobody
            else can see it, and it has no likes or comments. Deleting it here deletes the
            file.
          </Text>
        </View>

        {note ? <Text style={[type.note, s.note]}>{note}</Text> : null}

        <View style={s.actions}>
          <Button label="Edit" onPress={() => onEdit(clip)} grow />
          <Button
            label="Delete"
            onPress={confirmDelete}
            grow
            style={{ borderColor: c.recBorder }}
            accessibilityLabel={`Delete ${clip.name} from this device`}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  title: { flex: 1, textAlign: "center", fontFamily: font.sans, fontSize: 15, fontWeight: "600", color: c.text },
  // Balances the Done action so the title stays centred.
  headerSpacer: { width: 44 },
  stage: {
    flex: 1,
    marginHorizontal: 18,
    borderRadius: isIOS ? 12 : 14,
    overflow: "hidden",
    // A video well stays dark in both schemes — the theme's placeholder token.
    backgroundColor: c.placeholder,
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: c.scrim,
    borderWidth: 1,
    borderColor: c.w22,
  },
  playLabel: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", letterSpacing: 1, color: "#E8E9EA" },
  banner: {
    margin: 18,
    marginBottom: 0,
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: c.accentBgFaint,
    borderWidth: 1,
    borderColor: c.accentBorderFaint,
  },
  bannerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bannerLabel: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", letterSpacing: 1, color: c.accentSoft },
  bannerMeta: { fontFamily: font.mono, fontSize: 11, color: c.w50 },
  note: { paddingHorizontal: 18, paddingTop: 10, color: c.recText },
  actions: { flexDirection: "row", gap: 10, padding: 18 },
}));
