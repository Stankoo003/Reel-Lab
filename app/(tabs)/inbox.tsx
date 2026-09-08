// Inbox — the conversation list.
//
// Each row is one 1:1 thread: who it is with, the last thing said, and how many messages you
// have not read. Ordered by recency, which is the only order a chat list has ever wanted.
//
// A tab rather than a screen pushed from the profile. Messages are a place you go back to
// many times a day, and a destination reached by opening your own profile first is one you
// stop checking.
import { useCallback, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { fetchConversations, markAllConversationsDelivered } from "../../api/client";
import { errorMessage } from "../../src/errors";
import { useCurrentUserId } from "../../src/state/AuthContext";
import { statusOf } from "../../src/chat/receipts";
import Ticks from "../../src/chat/Ticks";
import { useConnectionState } from "../../src/chat/useConnectionState";
import { lastSocketError as socketReason, reconnectNow } from "../../src/chat/socket";
import Avatar, { tintFor } from "../../src/ui/Avatar";
import ErrorBox from "../../src/ui/ErrorBox";
import type { Conversation } from "../../api/client";

export default function MessagesScreen() {
  const router = useRouter();
  const meId = useCurrentUserId();
  const { c, type } = useTheme();
  const s = useStyles();
  const connection = useConnectionState();

  const [threads, setThreads] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setThreads(await fetchConversations());
      // The list has arrived on this device, which is what "delivered" means. Told after
      // the list is drawn, and not awaited: the second tick on someone else's screen is
      // not worth making this one wait, and a failure here is nothing to show.
      markAllConversationsDelivered().catch(() => {});
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // On focus rather than on mount: coming back from a thread has to redraw the unread count
  // that opening it just cleared.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={type.screenTitle}>Inbox</Text>
      </View>

      {/*
        Shown only when it is not "connected". A permanent "online" banner is chrome; a
        banner that appears when the socket is down is information — it tells you why the
        message you just sent is sitting there marked as pending.
      */}
      {/* Tappable, and it says why — see the same banner on the thread screen. */}
      {connection !== "connected" ? (
        <Pressable onPress={reconnectNow} style={s.banner} accessibilityRole="button">
          <Text style={s.bannerText}>
            {connection === "connecting"
              ? "Connecting…"
              : `Offline — ${socketReason() ?? "messages will send later"}`}
          </Text>
          <Text style={s.bannerAction}>TAP TO RETRY</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View style={s.errorWrap}>
          <ErrorBox message={error} onRetry={load} />
        </View>
      ) : null}

      <FlatList
        data={threads}
        keyExtractor={(thread) => String(thread.id)}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={c.w50} />
        }
        ListEmptyComponent={
          loading ? null : (
            <Text style={[type.note, s.empty]}>
              No conversations yet. Open someone's profile to start one.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const other = item.other;
          const name = other?.displayName ?? other?.username ?? "unknown";
          const unread = item.unreadCount ?? 0;
          const lastIsMine = !!item.lastMessage && String(item.lastMessage.senderId) === meId;
          return (
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              onPress={() =>
                router.push({
                  pathname: "/thread",
                  params: {
                    conversationId: String(item.id),
                    name,
                    userId: String(other?.id ?? ""),
                  },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={
                unread > 0 ? `${name}, ${unread} unread messages` : `Conversation with ${name}`
              }
            >
              <Avatar
                uri={other?.avatarUrl}
                name={name}
                size={46}
                tint={tintFor(other?.username)}
              />
              <View style={s.rowText}>
                <Text style={[s.name, unread > 0 && s.nameUnread]} numberOfLines={1}>
                  {name}
                </Text>
                {/*
                  numberOfLines, and nothing else. The body is rendered by a React Native
                  <Text>, which has no markup parser — a message containing <b> shows those
                  characters, which is the requirement and holds by construction.
                */}
                <View style={s.previewRow}>
                  {lastIsMine ? (
                    <Ticks
                      status={statusOf(item.lastMessage?.createdAt, item.otherReceipt ?? null)}
                      size={10}
                    />
                  ) : null}
                  <Text
                    style={[s.preview, unread > 0 && s.previewUnread]}
                    numberOfLines={1}
                  >
                    {item.lastMessage
                      ? item.lastMessage.body
                        || (item.lastMessage.video || item.lastMessage.videoRemoved
                          ? "Video"
                          : "")
                      : "No messages yet"}
                  </Text>
                </View>
              </View>
              {unread > 0 ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 18, paddingTop: isIOS ? 6 : 14, paddingBottom: 12 },
  banner: {
    marginHorizontal: 18,
    marginBottom: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
  },
  bannerText: { fontFamily: font.mono, fontSize: 10.5, color: c.recText },
  bannerAction: { marginTop: 3, fontFamily: font.mono, fontSize: 9, letterSpacing: 0.8, color: c.w50 },
  errorWrap: { paddingHorizontal: 18, paddingBottom: 8 },
  list: { paddingBottom: 28 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  rowPressed: { backgroundColor: c.w06 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: font.sans, fontSize: 14, fontWeight: "500", color: c.text },
  // Unread is carried by weight and brightness rather than by the badge alone — the badge is
  // small, and the row has to read as unread at a glance.
  nameUnread: { fontWeight: "700" },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  preview: { flex: 1, fontFamily: font.sans, fontSize: 12.5, color: c.w42 },
  previewUnread: { color: c.w70 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: c.accent,
    alignItems: "center",
  },
  badgeText: { fontFamily: font.mono, fontSize: 10.5, fontWeight: "700", color: "#FFFFFF" },
  empty: { textAlign: "center", paddingTop: 56, paddingHorizontal: 40 },
}));
