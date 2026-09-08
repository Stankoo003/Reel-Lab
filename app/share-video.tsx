// Share a clip into a conversation.
//
// Pushed from the feed's SHARE control with the clip's id and what it takes to show it.
// Every existing thread is a row; tapping one sends the clip there through the same outbox
// a typed message goes through, so a share made offline is delivered when the network is
// back rather than lost. Someone you have never messaged is reached from their profile
// first, which is where starting a conversation lives.
import { useCallback, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../src/theme";
import { fetchConversations } from "../api/client";
import { errorMessage } from "../src/errors";
import { enqueue } from "../src/chat/outbox";
import Avatar, { tintFor } from "../src/ui/Avatar";
import ErrorBox from "../src/ui/ErrorBox";
import type { Conversation } from "../api/client";

export default function ShareVideoScreen() {
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { videoId, title, ownerName, posterUrl } = useLocalSearchParams<{
    videoId: string;
    title?: string;
    ownerName?: string;
    posterUrl?: string;
  }>();

  const [threads, setThreads] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Threads this clip has been sent to from here — the row says so instead of re-sending. */
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setThreads(await fetchConversations());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function sendTo(thread: Conversation) {
    if (!videoId || !thread.id || sentTo.has(String(thread.id))) return;
    // Marked sent immediately: the outbox owns delivery from here, and a spinner on a row
    // would suggest the tap is still undecided when it is not.
    setSentTo((prev) => new Set(prev).add(String(thread.id)));
    await enqueue(String(thread.id), "", videoId);
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Text style={type.sectionTitle}>Share video</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
      </View>

      <View style={s.clip}>
        <View style={s.poster}>
          {posterUrl ? (
            <Image source={{ uri: posterUrl }} style={s.posterImage} contentFit="cover" />
          ) : null}
        </View>
        <View style={s.clipText}>
          <Text style={s.clipTitle} numberOfLines={2}>
            {title || "Video"}
          </Text>
          {ownerName ? <Text style={s.clipOwner}>{ownerName}</Text> : null}
        </View>
      </View>

      {error ? (
        <View style={s.errorWrap}>
          <ErrorBox message={error} onRetry={load} />
        </View>
      ) : null}

      <Text style={[type.note, s.sectionNote]}>Send to</Text>
      <FlatList
        data={threads}
        keyExtractor={(thread) => String(thread.id)}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={c.w42} style={s.spinner} />
          ) : (
            <Text style={[type.note, s.empty]}>
              No conversations yet. Open someone's profile to start one, then share from here.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const other = item.other;
          const name = other?.displayName ?? other?.username ?? "unknown";
          const sent = sentTo.has(String(item.id));
          const blocked = item.blocked === true;
          return (
            <View style={s.row}>
              <Avatar uri={other?.avatarUrl} name={name} size={42} tint={tintFor(other?.username)} />
              <View style={s.rowText}>
                <Text style={s.name} numberOfLines={1}>
                  {name}
                </Text>
                {blocked ? <Text style={s.blocked}>Blocked</Text> : null}
              </View>
              <Pressable
                onPress={() => sendTo(item)}
                disabled={sent || blocked}
                style={[s.sendButton, (sent || blocked) && s.sendButtonOff]}
                accessibilityRole="button"
                accessibilityLabel={sent ? `Sent to ${name}` : `Send to ${name}`}
              >
                <Text style={[s.sendLabel, sent && s.sendLabelOff]}>{sent ? "SENT" : "SEND"}</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: isIOS ? 6 : 14,
    paddingBottom: 12,
  },
  close: { fontFamily: font.sans, fontSize: 17, color: c.w50 },
  clip: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 18,
    padding: 12,
    borderRadius: 14,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.w07,
  },
  poster: { width: 56, height: 74, borderRadius: 8, overflow: "hidden", backgroundColor: "#000" },
  posterImage: { width: "100%", height: "100%" },
  clipText: { flex: 1, justifyContent: "center", gap: 3 },
  clipTitle: { fontFamily: font.sans, fontSize: 14.5, fontWeight: "600", color: c.text },
  clipOwner: { fontFamily: font.mono, fontSize: 11, color: c.w42 },
  errorWrap: { paddingHorizontal: 18, paddingTop: 10 },
  sectionNote: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 6 },
  list: { paddingBottom: 28 },
  spinner: { paddingVertical: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.sans, fontSize: 14, fontWeight: "500", color: c.text },
  blocked: { fontFamily: font.mono, fontSize: 10.5, color: c.recText },
  sendButton: {
    paddingHorizontal: 15,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonOff: { backgroundColor: c.accentBgDisabled },
  sendLabel: { fontFamily: font.mono, fontSize: 11, fontWeight: "700", color: "#FFFFFF" },
  sendLabelOff: { color: "rgba(255,255,255,0.85)" },
  empty: { textAlign: "center", paddingTop: 30, paddingHorizontal: 40 },
}));
