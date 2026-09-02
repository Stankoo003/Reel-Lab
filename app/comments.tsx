// Comments on one video: top-level comments, each with its replies, one level deep.
//
// Design 2a draws this as a sheet over the clip rather than a screen of its own — the video
// stays visible and keeps playing behind it, which is what every app in this category does
// and what the transparentModal presentation in app/_layout.tsx is for.
//
// The one-per-video rule is stated above the box, not discovered on submit. That is the
// whole point of surfacing it: writing a comment and losing it to a 409 is the failure this
// screen exists to avoid. The design shows an ordinary comment feed and does not depict the
// rule, but the server enforces it either way, so the rule stays.
import { useCallback, useState } from "react";
import type { ListRenderItem } from "react-native";
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCurrentUserId } from "../src/state/AuthContext";
import { FixedTheme, font, isIOS, themedStyles, useTheme } from "../src/theme";
import { fetchComments, findOwnRoot, postComment, updateComment } from "../src/comments";
import { useCursorPage } from "../src/hooks/useCursorPage";
import { relativeTime } from "../src/format";
import { errorMessage } from "../src/errors";
import Avatar from "../src/ui/Avatar";
import ErrorBox from "../src/ui/ErrorBox";
import type { Comment } from "../src/comments";

const MAX_BODY = 2000;

export default function CommentsScreen() {
  return (
    // The sheet is always over video, so it is dark by design rather than by preference —
    // the same rule the feed and the camera follow.
    <FixedTheme scheme="dark">
      <Comments />
    </FixedTheme>
  );
}

function Comments() {
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { videoId } = useLocalSearchParams<{ videoId: string; title?: string }>();
  const meId = useCurrentUserId();

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
      const page = await fetchComments(videoId, cursor);
      return { items: page.comments, nextCursor: page.nextCursor, hasNext: page.hasNext };
    },
    [videoId]
  );

  const {
    items: comments,
    loading,
    refreshing,
    loadingMore,
    error,
    pageError,
    hasNext,
    reload,
    loadMore,
  } = useCursorPage<Comment>(fetchPage);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Ids, not the Comment objects. Reloading rebuilds every object, so a captured one becomes
  // an orphan whose `replies` no longer reflect the server — and the composer's enabled state
  // was being computed from exactly that.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);

  // Looked up fresh on every render, so a reload cannot leave these pointing at stale objects.
  const replyingTo = comments.find((x) => x.id === replyingToId) ?? null;
  const editing =
    comments.flatMap((root) => [root, ...root.replies]).find((x) => x.id === editingId) ?? null;

  // Only the roots on the loaded pages are searched, which is why the composer's state is
  // derived rather than assumed: until your page is loaded, we do not claim your slot is free.
  const ownRoot = findOwnRoot(comments, meId ?? "");
  const ownReplyTo = replyingTo
    ? (replyingTo.replies.find((r) => r.authorId === meId) ?? null)
    : null;

  // What the composer is currently for, and whether it is allowed to submit.
  const target = replyingTo ? ownReplyTo : ownRoot;
  const slotTaken = target !== null && editing === null;

  // Only what has been paged in — no endpoint returns a total, so this counts what is on
  // screen rather than claiming the video's full tally.
  const shownCount = comments.reduce((n, root) => n + 1 + root.replies.length, 0);

  function startEdit(comment: Comment, parent: Comment | null) {
    setReplyingToId(parent?.id ?? null);
    setEditingId(comment.id);
    setDraft(comment.body);
    setSubmitError(null);
  }

  function startReply(root: Comment) {
    setReplyingToId(root.id);
    setEditingId(null);
    setDraft("");
    setSubmitError(null);
  }

  function cancel() {
    setReplyingToId(null);
    setEditingId(null);
    setDraft("");
    setSubmitError(null);
  }

  async function submit() {
    const body = draft.trim();
    if (!videoId || !body || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (editing) {
        await updateComment(editing.id, body);
      } else {
        await postComment(videoId, body, replyingTo?.id ?? null);
      }
      cancel();
      await reload();
    } catch (e) {
      // A 409 lands here when the pre-check was raced or the page holding your existing
      // comment had not loaded. The server's message already says to edit instead.
      setSubmitError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const renderThread: ListRenderItem<Comment> = ({ item: root }) => (
    <View style={s.thread}>
      <CommentRow
        comment={root}
        mine={root.authorId === meId}
        replyCount={root.replies.length}
        onEdit={() => startEdit(root, null)}
        onReply={() => startReply(root)}
        s={s}
      />
      {root.replies.map((reply) => (
        // One level and no further: a reply renders no reply affordance, matching
        // the server, which refuses a third level outright.
        <View key={reply.id} style={s.replyIndent}>
          <CommentRow
            comment={reply}
            mine={reply.authorId === meId}
            onEdit={() => startEdit(reply, root)}
            s={s}
          />
        </View>
      ))}
    </View>
  );

  const canSend = !slotTaken && !submitting && draft.trim().length > 0;

  return (
    // The avoider is the root, not something inside the sheet: the sheet is bottom-anchored
    // at a fixed height, so padding it from within would shrink the comment list and leave
    // the composer under the keyboard. Squeezing the whole stack lifts the sheet instead.
    <KeyboardAvoidingView
      style={s.root}
      behavior={isIOS ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* The clip shows through here. Tapping it dismisses, the way a sheet's scrim does. */}
      <Pressable
        style={s.scrim}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close comments"
      />

      <View style={s.sheet}>
        <View style={s.grabberWrap}>
          <View style={s.grabber} />
        </View>

        <View style={s.header}>
          <Text style={type.sectionTitle}>
            {shownCount} {shownCount === 1 ? "comment" : "comments"}
          </Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
        </View>

        {!videoId ? (
          <Text style={s.empty}>No video.</Text>
        ) : (
          <View style={s.fill}>
            {/* A FlatList, so a long thread list only ever renders what is on screen —
                the ScrollView it replaces mounted every loaded page at once. */}
            <FlatList
              style={s.fill}
              data={comments}
              keyExtractor={(root) => root.id}
              renderItem={renderThread}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => reload({ pull: true })}
                  tintColor={c.w50}
                />
              }
              ListHeaderComponent={
                <>
                  {loading ? <ActivityIndicator color={c.w50} style={s.spinner} /> : null}
                  {error ? <ErrorBox message={error} onRetry={() => reload()} /> : null}
                  {!loading && comments.length === 0 && !error ? (
                    <Text style={s.empty}>No comments yet. Yours would be the first.</Text>
                  ) : null}
                </>
              }
              ListFooterComponent={
                <>
                  {/* A failed page fetch is reported here, not in the list-level slot: the
                      comments already on screen are fine, and blanking them would be worse. */}
                  {pageError ? <ErrorBox message={pageError} onRetry={loadMore} /> : null}

                  {hasNext ? (
                    <Pressable
                      onPress={loadMore}
                      disabled={loadingMore}
                      style={s.more}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: loadingMore }}
                    >
                      {loadingMore ? (
                        <ActivityIndicator color={c.w50} />
                      ) : (
                        <Text style={s.moreText}>Load more comments</Text>
                      )}
                    </Pressable>
                  ) : null}
                </>
              }
            />

            <View style={s.composer}>
              {/*
                The rule, stated before anything is typed. Which sentence shows depends on
                whether the slot is already used, so this doubles as the answer to "why is
                the box disabled" without anyone having to submit and fail.
              */}
              <Text style={s.rule}>
                {replyingTo
                  ? slotTaken
                    ? "You have already replied to this comment. Edit your reply instead."
                    : `One reply per person, per comment. Replying to ${replyingTo.authorName}.`
                  : slotTaken
                    ? "You have already commented on this video. Edit your comment instead."
                    : "One comment per person, per video. You can edit it afterwards."}
              </Text>

              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  value={draft}
                  onChangeText={setDraft}
                  editable={!slotTaken && !submitting}
                  placeholder={
                    slotTaken
                      ? "Edit your comment above"
                      : editing
                        ? "Edit your comment…"
                        : "Add comment…"
                  }
                  placeholderTextColor={c.w42}
                  multiline
                  maxLength={MAX_BODY}
                  // Text only: no rich input, no attachments, nothing to paste but characters.
                  accessibilityLabel={editing ? "Edit your comment" : "Write a comment"}
                  accessibilityHint={
                    slotTaken ? "Disabled. You already have a comment here." : undefined
                  }
                />
                <Pressable
                  onPress={submit}
                  disabled={!canSend}
                  style={[s.send, !canSend && s.sendDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? "Save changes" : "Post comment"}
                  accessibilityState={{ disabled: !canSend }}
                >
                  <Text style={s.sendText}>
                    {submitting ? "…" : editing ? "SAVE" : "SEND"}
                  </Text>
                </Pressable>
              </View>

              {(editing || replyingTo) && !submitting ? (
                <Pressable onPress={cancel} accessibilityRole="button" hitSlop={8}>
                  <Text style={s.hint}>Cancel</Text>
                </Pressable>
              ) : null}

              {submitError ? <Text style={type.error}>{submitError}</Text> : null}
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function CommentRow({
  comment,
  mine,
  replyCount,
  onEdit,
  onReply,
  s,
}: {
  comment: Comment;
  mine: boolean;
  /** Absent on a reply — replies do not nest further. */
  replyCount?: number;
  onEdit: () => void;
  onReply?: () => void;
  s: ReturnType<typeof useStyles>;
}) {
  const { type } = useTheme();

  return (
    <View style={s.comment}>
      <Avatar name={comment.authorName} size={36} />

      <View style={s.commentBody}>
        <Text style={s.author}>
          {comment.authorName}
          {mine ? " (you)" : ""}
          {comment.edited ? " · edited" : ""}
        </Text>
        {/*
          A React Native <Text> renders its content literally — there is no HTML parser and
          no markdown renderer anywhere in this path — so a body containing <b> or ** shows
          those characters. That is the requirement, and it holds by construction rather than
          by escaping.
        */}
        <Text style={[type.commentBody, s.text]}>{comment.body}</Text>

        <View style={s.actions}>
          <Text style={s.action}>{relativeTime(comment.createdAt)}</Text>
          {onReply ? (
            <Pressable onPress={onReply} accessibilityRole="button" hitSlop={8}>
              <Text style={s.action}>Reply</Text>
            </Pressable>
          ) : null}
          {replyCount ? <Text style={s.action}>{replyCount}</Text> : null}
          {mine ? (
            <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8}>
              <Text style={s.action}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/*
        The design gives each comment a like control. Nothing on the server stores a like
        against a comment — CommentResponse has no count and there is no endpoint — so the
        column keeps the design's shape without offering an action that would do nothing.
      */}
      <View style={s.likeCol}>
        <Text style={s.heart}>♡</Text>
        <Text style={s.likeCount}>—</Text>
      </View>
    </View>
  );
}

const useStyles = themedStyles(({ c, type }) => ({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1 },
  fill: { flex: 1 },
  sheet: {
    // The design's proportion: enough of the clip stays visible to keep watching.
    height: "62%",
    backgroundColor: c.sheet,
    borderTopLeftRadius: isIOS ? 18 : 22,
    borderTopRightRadius: isIOS ? 18 : 22,
    // iOS lifts the sheet off the video; Android's elevation does the same job natively.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -14 },
    shadowRadius: 40,
    shadowOpacity: 0.55,
    elevation: 24,
  },
  grabberWrap: { alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 38, height: 4, borderRadius: 99, backgroundColor: c.w18 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.w07,
  },
  close: { fontFamily: font.sans, fontSize: 17, color: c.w50 },
  list: { padding: 18, gap: 18, paddingBottom: 24 },
  spinner: { marginTop: 24 },
  thread: { gap: 14 },
  comment: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
  commentBody: { flex: 1, minWidth: 0 },
  replyIndent: {
    paddingLeft: 18,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: c.w18,
  },
  author: { fontFamily: font.sans, fontSize: 12, fontWeight: "500", color: c.w50 },
  text: { marginTop: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 7 },
  action: { fontFamily: font.mono, fontSize: 11, color: c.w38 },
  likeCol: { alignItems: "center", gap: 3, paddingTop: 2 },
  heart: { fontFamily: font.sans, fontSize: 15, lineHeight: 15, color: c.w38 },
  likeCount: { fontFamily: font.mono, fontSize: 10, fontWeight: "500", color: c.w42 },
  empty: { ...type.note, textAlign: "center", marginTop: 32 },
  more: { alignSelf: "center", paddingVertical: 12 },
  moreText: { ...type.control },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: isIOS ? 34 : 16,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.w07,
  },
  rule: { ...type.note },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    fontFamily: font.sans,
    fontSize: 13.5,
    color: c.text,
    flex: 1,
    minHeight: isIOS ? 42 : 46,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 99,
    backgroundColor: c.w07,
  },
  send: {
    width: isIOS ? 42 : 46,
    height: isIOS ? 42 : 46,
    borderRadius: 99,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "600", color: "#FFFFFF" },
  hint: { ...type.note },
}));
