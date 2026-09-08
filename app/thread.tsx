// One conversation.
//
// Three sources feed the same list, and keeping them from fighting is most of this screen:
//   • history, paged from the API as you scroll up
//   • live messages, from the socket
//   • your own pending messages, from the outbox, which have not been accepted yet
//
// They are merged by id, so a message that arrives twice — over the socket AND in a page —
// is drawn once.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../src/theme";
import {
  blockUser,
  fetchMessages,
  fetchMessagesSince,
  markConversationRead,
  reportMessage,
} from "../api/client";
import { errorMessage } from "../src/errors";
import { useCurrentUserId } from "../src/state/AuthContext";
import {
  lastSocketError as socketReason,
  reconnectNow,
  watchConversation,
} from "../src/chat/socket";
import { useConnectionState } from "../src/chat/useConnectionState";
import {
  enqueue,
  flush,
  pendingFor,
  reconcile,
  remove,
  retry,
  subscribeToOutbox,
} from "../src/chat/outbox";
import { mergeReceipt, statusOf } from "../src/chat/receipts";
import Ticks from "../src/chat/Ticks";
import VideoCard, { VideoGone } from "../src/chat/VideoCard";
import VideoPreview from "../src/chat/VideoPreview";
import ErrorBox from "../src/ui/ErrorBox";
import type { DirectMessage, Receipt, SharedVideo } from "../api/client";
import type { QueuedMessage } from "../src/chat/outbox";

/** A delivered message, or one still waiting to be. The list draws both. */
type Row =
  | { kind: "sent"; message: DirectMessage }
  | { kind: "pending"; queued: QueuedMessage };

export default function ThreadScreen() {
  const router = useRouter();
  const meId = useCurrentUserId();
  const { c, type } = useTheme();
  const s = useStyles();
  const connection = useConnectionState();
  const { conversationId, name, userId } = useLocalSearchParams<{
    conversationId: string;
    name?: string;
    userId?: string;
  }>();

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [pending, setPending] = useState<QueuedMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * How far the OTHER person has received and read — what the ticks under your own
   * messages are drawn from. Comes with the first page and moves with the socket.
   */
  const [otherReceipt, setOtherReceipt] = useState<Receipt | null>(null);
  /** The shared clip being watched, if one is open over the thread. */
  const [previewing, setPreviewing] = useState<SharedVideo | null>(null);

  /**
   * The newest message the thread has seen, as a timestamp.
   *
   * A ref, not state: the reconnect effect reads it, and putting it in the dependency list
   * would re-run that effect on every message — reconnecting the reconciliation to itself.
   */
  const newestAt = useRef<string | null>(null);

  /** Merge by id, newest first. The one place duplicates are prevented. */
  const absorb = useCallback((incoming: DirectMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [String(m.id), m]));
      for (const message of incoming) byId.set(String(message.id), message);
      const merged = [...byId.values()].sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      );
      newestAt.current = merged.length
        ? String(merged[0].createdAt)
        : newestAt.current;
      return merged;
    });
  }, []);

  const loadNewest = useCallback(async () => {
    if (!conversationId) return;
    setError(null);
    try {
      const page = await fetchMessages(conversationId);
      absorb(page.items ?? []);
      setOtherReceipt((prev) => mergeReceipt(prev, page.otherReceipt));
      setCursor(page.nextCursor ?? null);
      setHasMore(Boolean(page.hasMore));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [conversationId, absorb]);

  /**
   * Older messages, as the reader scrolls up.
   *
   * Guarded on `loadingOlder` because onEndReached fires repeatedly while a slow page is in
   * flight, and three overlapping requests for the same cursor is how a thread ends up
   * showing the same twenty messages three times.
   */
  const loadOlder = useCallback(async () => {
    if (!conversationId || !cursor || !hasMore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, cursor);
      absorb(page.items ?? []);
      setCursor(page.nextCursor ?? null);
      setHasMore(Boolean(page.hasMore) && (page.items?.length ?? 0) > 0);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, hasMore, loadingOlder, absorb]);

  // First load, and marking the thread read. Opening it IS reading it.
  useEffect(() => {
    loadNewest();
    if (conversationId) markConversationRead(conversationId).catch(() => {});
  }, [conversationId, loadNewest]);

  // Live messages.
  useEffect(() => {
    if (!conversationId) return;
    return watchConversation(conversationId, (event) => {
      if (event.kind === "receipt") {
        // Only the other side's receipt moves the ticks. Our own comes back on the same
        // topic every time we mark the thread read, and says nothing about our messages.
        if (String(event.receipt.userId) !== meId) {
          setOtherReceipt((prev) => mergeReceipt(prev, event.receipt));
        }
        return;
      }
      const { message } = event;
      absorb([message]);
      // Our own optimistic copy, if this is one — drop the pending bubble rather than
      // drawing the same message twice.
      reconcile(message);
      // Arriving while the thread is open means it has been read. Our own message needs no
      // receipt: the server reads it for us on send.
      if (String(message.senderId) !== meId) {
        markConversationRead(conversationId).catch(() => {});
      }
    });
  }, [conversationId, absorb, meId]);

  /**
   * Reconnect reconciliation.
   *
   * The socket delivered nothing while it was down and cannot say so. Rather than trusting
   * the live stream to have been complete, ask the server what arrived after the newest
   * message we hold — and flush anything that was queued while offline.
   */
  useEffect(() => {
    if (connection !== "connected" || !conversationId) return;
    let alive = true;
    (async () => {
      try {
        if (newestAt.current) {
          const missed = await fetchMessagesSince(
            conversationId,
            newestAt.current,
          );
          if (alive && missed.length) absorb(missed);
        } else {
          await loadNewest();
        }
      } catch {
        // A failed reconciliation is not worth an error banner: the next reconnect, or a
        // pull to refresh, tries again.
      }
      void flush();
    })();
    return () => {
      alive = false;
    };
  }, [connection, conversationId, absorb, loadNewest]);

  // The outbox, which changes as sends succeed and fail.
  useEffect(() => {
    if (!conversationId) return;
    const update = () => setPending(pendingFor(conversationId));
    update();
    return subscribeToOutbox(update);
  }, [conversationId]);

  const rows = useMemo<Row[]>(() => {
    // Pending first because the list is inverted: newest at the bottom, and a message you
    // just wrote is the newest thing there is.
    return [
      ...[...pending]
        .reverse()
        .map((queued) => ({ kind: "pending" as const, queued })),
      ...messages.map((message) => ({ kind: "sent" as const, message })),
    ];
  }, [messages, pending]);

  async function send() {
    const body = draft.trim();
    if (!body || !conversationId) return;
    // Cleared immediately. The message is in the outbox now — it is not lost if the send
    // fails, and leaving the text in the box would invite sending it twice.
    setDraft("");
    await enqueue(conversationId, body);
  }

  function confirmBlock() {
    if (!userId) return;
    Alert.alert(
      `Block ${name ?? "this person"}?`,
      "They will not be able to message you, and you will not be able to message them. You can undo this from their profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockUser(userId);
              router.back();
            } catch (e) {
              setError(errorMessage(e));
            }
          },
        },
      ],
    );
  }

  function confirmReport(message: DirectMessage) {
    if (String(message.senderId) === meId) return;
    Alert.alert(
      "Report this message?",
      "The message and your name go to whoever reviews reports. The sender is not told.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            try {
              await reportMessage(String(message.id));
              Alert.alert("Reported", "Thanks — someone will look at it.");
            } catch (e) {
              setError(errorMessage(e));
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
        >
          <Text style={type.action}>Back</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1}>
          {name ?? "Conversation"}
        </Text>
        <Pressable
          onPress={confirmBlock}
          hitSlop={12}
          accessibilityRole="button"
        >
          <Text style={s.block}>Block</Text>
        </Pressable>
      </View>

      {/*
        Tappable, and it says WHY. "Offline" on its own is the least useful thing an app can
        tell you about a connection — every cause looks the same. The reason comes from the
        socket itself; tapping retries rather than making you wait out the backoff.
      */}
      {connection !== "connected" ? (
        <Pressable
          onPress={reconnectNow}
          style={s.banner}
          accessibilityRole="button"
        >
          <Text style={s.bannerText}>
            {connection === "connecting"
              ? "Connecting…"
              : `Offline — ${socketReason() ?? "what you write will send when you are back"}`}
          </Text>
          <Text style={s.bannerAction}>TAP TO RETRY</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View style={s.errorWrap}>
          <ErrorBox message={error} onRetry={loadNewest} />
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={s.fill}
        behavior={isIOS ? "padding" : undefined}
        keyboardVerticalOffset={isIOS ? 8 : 0}
      >
        <FlatList
          data={rows}
          // Newest at the bottom, which is where a chat's attention is. Inverted rather than
          // scrolled-to-end on every change: scrolling would fight the reader every time a
          // message arrived while they were looking at history.
          inverted
          keyExtractor={(row) =>
            row.kind === "sent"
              ? `m-${row.message.id}`
              : `p-${row.queued.clientId}`
          }
          contentContainerStyle={s.list}
          // Inverted, so "end" is the TOP of the thread — this is scrolling into history.
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingOlder ? (
              <ActivityIndicator color={c.w42} style={s.older} />
            ) : null
          }
          ListEmptyComponent={
            loading ? null : (
              <Text style={[type.note, s.empty]}>
                No messages yet. Say something.
              </Text>
            )
          }
          renderItem={({ item }) => {
            if (item.kind === "pending") {
              return <PendingBubble queued={item.queued} s={s} />;
            }
            const mine = String(item.message.senderId) === meId;
            return (
              <Pressable
                onLongPress={() => confirmReport(item.message)}
                delayLongPress={400}
                style={[
                  s.bubbleRow,
                  mine ? s.bubbleRowMine : s.bubbleRowTheirs,
                ]}
                accessibilityRole="text"
              >
                <View
                  style={[
                    s.bubble,
                    mine ? s.bubbleMine : s.bubbleTheirs,
                    // A shared clip fills its bubble edge to edge: the poster is the
                    // frame, and a band of bubble colour around it reads as a mistake.
                    !!item.message.video && s.bubbleVideo,
                  ]}
                >
                  {item.message.video ? (
                    <VideoCard
                      video={item.message.video}
                      onOpen={setPreviewing}
                      trailing={
                        mine ? (
                          <Ticks
                            status={statusOf(item.message.createdAt, otherReceipt)}
                            onAccent
                          />
                        ) : null
                      }
                    />
                  ) : item.message.videoRemoved ? (
                    <VideoGone mine={mine} />
                  ) : null}
                  {/* A shared clip without words has no text line — an empty one would
                      leave a blank gap under the card. */}
                  {item.message.body ? (
                    <Text style={[s.body, mine && s.bodyMine, !!item.message.video && s.bodyUnderCard]}>
                      {item.message.body}
                    </Text>
                  ) : null}
                  {/* The ticks sit in the clip's title strip when there is one. */}
                  {mine && !item.message.video ? (
                    <View style={s.ticks}>
                      <Ticks status={statusOf(item.message.createdAt, otherReceipt)} onAccent />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />

        <View style={s.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={c.w38}
            style={s.input}
            multiline
            maxLength={4000}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim()}
            style={[s.sendButton, !draft.trim() && s.sendButtonOff]}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={s.sendLabel}>SEND</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {previewing ? (
        <VideoPreview video={previewing} onClose={() => setPreviewing(null)} />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * A message that has been written but not accepted.
 *
 * Shown differently rather than hidden: a message you typed and cannot see is one you will
 * type again. When the server has refused it for good, the bubble says why and offers the
 * only two things left — try again, or throw it away.
 */
function PendingBubble({
  queued,
  s,
}: {
  queued: QueuedMessage;
  s: ReturnType<typeof useStyles>;
}) {
  return (
    <View style={[s.bubbleRow, s.bubbleRowMine]}>
      <View style={[s.bubble, s.bubbleMine, s.bubblePending]}>
        <Text style={[s.body, s.bodyMine]}>
          {queued.body || (queued.videoId ? "Video" : "")}
        </Text>
        <Text style={s.pendingNote}>
          {queued.error ? queued.error : "Sending…"}
        </Text>
        {queued.error ? (
          <View style={s.pendingActions}>
            <Pressable onPress={() => retry(queued.clientId)} hitSlop={8}>
              <Text style={s.pendingAction}>RETRY</Text>
            </Pressable>
            <Pressable onPress={() => remove(queued.clientId)} hitSlop={8}>
              <Text style={s.pendingAction}>DISCARD</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  fill: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: isIOS ? 6 : 14,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontFamily: font.sans,
    fontSize: 15,
    fontWeight: "600",
    color: c.text,
  },
  block: { fontFamily: font.sans, fontSize: 13, color: c.recText },
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
  bannerAction: {
    marginTop: 3,
    fontFamily: font.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: c.w50,
  },
  errorWrap: { paddingHorizontal: 18, paddingBottom: 8 },
  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  older: { paddingVertical: 14 },
  empty: { textAlign: "center", paddingVertical: 40 },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 16,
  },
  // A shared clip fills its bubble edge to edge; the poster is the frame.
  bubbleVideo: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", maxWidth: 230 },
  bubbleMine: { backgroundColor: c.accent, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: c.panel, borderBottomLeftRadius: 5 },
  // Dimmer than a delivered one, so "not sent yet" reads without a label.
  bubblePending: { opacity: 0.62 },
  body: {
    fontFamily: font.sans,
    fontSize: 14.5,
    lineHeight: 20,
    color: c.text,
  },
  bodyMine: { color: "#FFFFFF" },
  bodyUnderCard: { paddingHorizontal: 12, paddingBottom: 9 },
  // Bottom right, where every chat app puts them — the eye already knows to look there.
  ticks: {
    alignSelf: "flex-end",
    marginTop: 2,
    marginBottom: -3,
    marginRight: -4,
  },
  pendingNote: {
    marginTop: 4,
    fontFamily: font.mono,
    fontSize: 9.5,
    color: "rgba(255,255,255,0.85)",
  },
  pendingActions: { flexDirection: "row", gap: 14, marginTop: 6 },
  pendingAction: {
    fontFamily: font.mono,
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: isIOS ? 4 : 10,
    borderTopWidth: 1,
    borderTopColor: c.w07,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w14,
    fontFamily: font.sans,
    fontSize: 14.5,
    color: c.text,
  },
  sendButton: {
    paddingHorizontal: 15,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonOff: { backgroundColor: c.accentBgDisabled },
  sendLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
}));
