// Someone else's profile, read-only — reached from a feed row's @username or from Search.
//
// Separate route rather than a mode of the Profile tab, because they answer different
// questions: that tab is always "me", this is always "them". What they share is ProfileCard
// and VideoTile, so the two renderings cannot drift.
//
// One FlatList, like the profile tab, for the same reason: the header and the grid are one
// scrolling column, and a grid nested in a ScrollView would be a second scroll container.
import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../src/theme";
import { followUser, getProfile, openConversation, unfollowUser } from "../api/client";
import { useCurrentUserId } from "../src/state/AuthContext";
import { fetchUserVideos } from "../src/library";
import { errorMessage } from "../src/errors";
import ProfileCard from "../src/profile/ProfileCard";
import VideoTile from "../src/profile/VideoTile";
import ClipSheet from "../src/profile/ClipSheet";
import ErrorBox from "../src/ui/ErrorBox";
import type { Profile } from "../api/client";
import type { Clip } from "../src/types";

export default function UserProfileScreen() {
  const meId = useCurrentUserId();
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [videos, setVideos] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Their clip being watched, if any. Null closes the sheet and releases its player. */
  const [preview, setPreview] = useState<Clip | null>(null);

  /** Optimistic, so the button answers the press rather than the round trip. */
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [loaded, theirs] = await Promise.all([
        getProfile(userId),
        // Published only — a draft is not yours to see, and the server is what decides that.
        fetchUserVideos(userId),
      ]);
      setProfile(loaded);
      setVideos(theirs);
      setFollowing(loaded.followedByViewer ?? false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Reaching your own profile through this route should still be editable — the rule is
  // "your own profile is editable", not "this screen is read-only".
  const isSelf = userId === meId;

  async function toggleFollow() {
    if (!userId || followBusy) return;
    const next = !following;
    // Flipped first. The server call is idempotent both ways, so a retry or a double press
    // cannot leave the counts wrong — see FollowService.
    setFollowing(next);
    setFollowBusy(true);
    setFollowError(null);
    try {
      const state = next ? await followUser(userId) : await unfollowUser(userId);
      // The server's answer wins over the guess, and carries the new counts with it.
      setFollowing(state.followedByViewer ?? next);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              followedByViewer: state.followedByViewer,
              activity: prev.activity
                ? { ...prev.activity, followers: state.followers, following: state.following }
                : prev.activity,
            }
          : prev
      );
    } catch (e) {
      // Put the button back where it was. A button left showing "Following" after the
      // request failed is a lie the user would only discover on the next reload.
      setFollowing(!next);
      setFollowError(errorMessage(e));
    } finally {
      setFollowBusy(false);
    }
  }

  /**
   * Open the thread with this person.
   *
   * The conversation is created here rather than on the thread screen, because the server is
   * what decides whether one may exist at all — a block is refused with a 403, and finding
   * that out before navigating means the failure lands on the screen the user is looking at.
   */
  async function message() {
    if (!userId || opening) return;
    setOpening(true);
    setFollowError(null);
    try {
      const thread = await openConversation(userId);
      router.push({
        pathname: "/thread",
        params: {
          conversationId: String(thread.id),
          name: profile?.displayName ?? profile?.username ?? "",
          userId,
        },
      });
    } catch (e) {
      setFollowError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }

  const header = (
    <View style={s.headerBlock}>
      {loading ? <ActivityIndicator color={c.w50} style={s.spinner} /> : null}

      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {profile ? (
        <>
          <ProfileCard
            profile={profile}
            editable={isSelf}
            onSaved={setProfile}
            // Absent on your own profile: the server refuses a self-follow, so the control
            // would be one that cannot work.
            follow={
              isSelf
                ? undefined
                : { following, busy: followBusy, onToggle: toggleFollow }
            }
          />

          {/* Absent on your own profile — messaging yourself is refused by the server. */}
          {isSelf ? null : (
            <Pressable
              onPress={message}
              disabled={opening}
              style={[s.messageButton, opening && s.messageButtonBusy]}
              accessibilityRole="button"
              accessibilityLabel={`Message ${profile.displayName ?? profile.username}`}
            >
              <Text style={s.messageLabel}>{opening ? "OPENING…" : "MESSAGE"}</Text>
            </Pressable>
          )}

          {followError ? <Text style={[type.error, s.followError]}>{followError}</Text> : null}

          <View style={s.sectionHead}>
            <Text style={type.sectionTitle}>Videos</Text>
            <Text style={s.sectionMeta}>newest first</Text>
          </View>

          {videos.length === 0 ? (
            <Text style={[type.note, s.empty]}>Nothing published yet.</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={type.action}>Back</Text>
        </Pressable>
        <Text style={s.handle} numberOfLines={1}>
          @{profile?.username ?? "…"}
        </Text>
        {/* Balances the handle against Back. */}
        <View style={s.topSpacer} />
      </View>

      <FlatList
        data={videos}
        keyExtractor={(v) => v.id}
        numColumns={2}
        columnWrapperStyle={s.column}
        contentContainerStyle={s.body}
        ListHeaderComponent={header}
        renderItem={({ item }) => <VideoTile clip={item} onPress={setPreview} />}
      />

      {/*
        Their clip, so the sheet gets no Edit and no Delete — omitted rather than shown and
        refused. Watching is the whole of what this screen offers.
      */}
      {preview ? <ClipSheet clip={preview} onClose={() => setPreview(null)} /> : null}
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  handle: { flex: 1, textAlign: "center", fontFamily: font.sans, fontSize: isIOS ? 14 : 16, fontWeight: "600", color: c.text },
  topSpacer: { width: 40 },
  headerBlock: { paddingHorizontal: 18, gap: 14, marginBottom: 14 },
  body: { paddingBottom: 28 },
  column: { gap: 12, paddingHorizontal: 18, marginBottom: 12 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  sectionMeta: { fontFamily: font.mono, fontSize: 11.5, color: c.w38 },
  empty: { textAlign: "center", paddingVertical: 24 },
  messageButton: {
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.w16,
    alignItems: "center",
    justifyContent: "center",
  },
  messageButtonBusy: { opacity: 0.5 },
  messageLabel: { fontFamily: font.mono, fontSize: 11, fontWeight: "600", letterSpacing: 0.8, color: c.text },
  followError: { marginTop: -4 },
  spinner: { marginTop: 32 },
}));
