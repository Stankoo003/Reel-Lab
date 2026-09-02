// Feed — vertical, one clip per screen, the visible one plays by itself.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ListRenderItem, ViewToken } from "react-native";
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  AppState,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FixedTheme, font, themedStyles, useTheme } from "../../src/theme";
import { useClips } from "../../src/state/ClipsContext";
import { canEdit, isServerBacked, fetchFeedPage } from "../../src/library";
import { useCursorPage } from "../../src/hooks/useCursorPage";
import ErrorBox from "../../src/ui/ErrorBox";
import { likeVideo, unlikeVideo } from "../../api/client";
import { useVideoPool } from "../../src/feed/useVideoPool";
import FeedItem from "../../src/feed/FeedItem";
import type { Clip } from "../../src/types";

// 80%: a row must clearly own the screen before it takes over playback, otherwise
// mid-swipe both neighbours would qualify and playback would flicker between them.
const VIEWABILITY = { itemVisiblePercentThreshold: 80 };

/**
 * The feed is full-bleed video edge to edge, so its chrome is dark in both schemes —
 * white furniture around a moving picture is wrong here regardless of device setting.
 */
export default function FeedRoute() {
  return (
    <FixedTheme scheme="dark">
      <FeedScreen />
    </FixedTheme>
  );
}

function FeedScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { selectClip } = useClips();
  const [activeIndex, setActiveIndex] = useState(0);
  // Playback intent lives here, not in the row: rows are recycled and their players are
  // borrowed, so state kept down there would be lost on a swipe or attach to the wrong clip.
  const [paused, setPaused] = useState(false);
  // Mute is about the feed, so it survives swiping to the next clip. Pausing does not —
  // arriving at a new clip and finding it frozen would read as a broken feed.
  const [muted, setMuted] = useState(false);
  const [focused, setFocused] = useState(true);
  const [foreground, setForeground] = useState(true);
  // Measured rather than derived from Dimensions minus guesses at the tab bar and
  // safe areas — measuring is what keeps paging aligned on both platforms.
  const [itemHeight, setItemHeight] = useState(0);
  /** videoId -> most recent like tap, so out-of-order replies can be dropped. */
  const likeSeq = useRef(new Map<string, number>());
  const listRef = useRef<FlatList<Clip>>(null);

  /**
   * A reload replaces the list, so the reader's position has to go with it. Leaving
   * activeIndex at 7 when the new list has 4 clips leaves the pool's window empty and every
   * visible row renders black, with nothing correcting it until the next swipe.
   */
  const onReloaded = useCallback(() => {
    setActiveIndex(0);
    setPaused(false);
    likeSeq.current.clear();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const {
    items: videos,
    loading,
    refreshing,
    loadingMore,
    error,
    pageError,
    reload,
    loadMore,
    setItems: setVideos,
  } = useCursorPage<Clip>(
    useCallback(async (cursor?: string | null) => {
      const page = await fetchFeedPage(cursor);
      return { items: page.clips, nextCursor: page.nextCursor, hasNext: page.hasNext };
    }, []),
    onReloaded
  );

  const { playerFor, pauseAll } = useVideoPool({
    items: videos,
    activeIndex,
    enabled: focused && foreground && itemHeight > 0,
    paused,
    muted,
  });

  useEffect(() => {
    setPaused(false);
  }, [activeIndex]);

  // Leaving the tab must stop the audio, not just hide the picture.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        pauseAll();
      };
    }, [pauseAll])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setForeground(active);
      if (!active) pauseAll();
    });
    return () => sub.remove();
  }, [pauseAll]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Clip>[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  const openEditor = useCallback(
    (clip: Clip) => {
      if (!canEdit(clip)) return;
      selectClip(clip);
      router.push("/editor");
    },
    [router, selectClip]
  );

  const openComments = useCallback(
    (clip: Clip) =>
      router.push({ pathname: "/comments", params: { videoId: clip.id, title: clip.name } }),
    [router]
  );

  /**
   * Toggle a like, optimistically.
   *
   * The row updates before the request goes out, and the server's authoritative count
   * replaces the guess when it answers — that reconciliation is what keeps the number right
   * when someone else liked the same clip in between. If the request fails, the clip is put
   * back exactly as it was rather than left showing a like that does not exist.
   *
   * Rapid toggling is safe because both endpoints are idempotent: the last request to land
   * decides, and none of them accumulate.
   */
  const toggleLike = useCallback(async (clip: Clip) => {
    const wasLiked = clip.likedByViewer === true;
    const previousCount = clip.likeCount ?? 0;

    const apply = (id: string, liked: boolean, count: number) =>
      setVideos((current) =>
        current.map((v) =>
          v.id === id ? { ...v, likedByViewer: liked, likeCount: Math.max(0, count) } : v
        )
      );

    // Stamp this tap. Toggling fast puts several requests in flight at once, and they can
    // answer out of order — adopting a slow "liked" reply after a later "unliked" one would
    // leave the screen disagreeing with the database. Only the newest tap may write.
    const seq = (likeSeq.current.get(clip.id) ?? 0) + 1;
    likeSeq.current.set(clip.id, seq);
    const isStale = () => likeSeq.current.get(clip.id) !== seq;

    apply(clip.id, !wasLiked, wasLiked ? previousCount - 1 : previousCount + 1);
    try {
      const state = wasLiked
        ? await unlikeVideo(clip.id)
        : await likeVideo(clip.id);
      // The server's count, not ours — that reconciliation is what keeps the number right
      // when someone else liked the same clip in between.
      if (!isStale()) apply(clip.id, state.likedByViewer, state.likeCount);
    } catch {
      // Roll back to what was on screen before the tap. Deliberately silent: a like is not
      // worth an error banner over the video, and the restored state is the message.
      if (!isStale()) apply(clip.id, wasLiked, previousCount);
    } finally {
      // Nothing else is in flight for this clip, so the entry has no more work to do. Without
      // this the map keeps one entry per liked video for the life of the tab.
      if (!isStale()) likeSeq.current.delete(clip.id);
    }
  }, [setVideos]);

  const openProfile = useCallback(
    (ownerId: string) => router.push({ pathname: "/user", params: { userId: ownerId } }),
    [router]
  );

  const togglePlay = useCallback(() => setPaused((p) => !p), []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const renderItem = useCallback<ListRenderItem<Clip>>(
    ({ item, index }) => (
      <FeedItem
        clip={item}
        player={playerFor(index)}
        height={itemHeight}
        isActive={index === activeIndex}
        muted={muted}
        onTogglePlay={togglePlay}
        onToggleMute={toggleMute}
        // Null, not a disabled button: a clip that never reached the server has nothing
        // to comment on, so the affordance is absent rather than inert.
        onComments={isServerBacked(item) ? () => openComments(item) : null}
        // Null for a clip that only exists on this device, same rule as comments.
        onToggleLike={isServerBacked(item) ? () => toggleLike(item) : null}
        liked={item.likedByViewer === true}
        likeCount={item.likeCount ?? 0}
        onOpenProfile={item.ownerId ? () => openProfile(item.ownerId!) : null}
        canEdit={canEdit(item)}
        onEdit={() => openEditor(item)}
      />
    ),
    [
      playerFor,
      itemHeight,
      activeIndex,
      muted,
      togglePlay,
      toggleMute,
      openEditor,
      openComments,
      toggleLike,
      openProfile,
    ]
  );

  // Sized to the row so a partially-visible footer can never break the snap interval.
  const footer = useCallback(() => {
    if (loadingMore) {
      return (
        <View style={[s.footer, { height: itemHeight }]}>
          <ActivityIndicator color={c.w50} />
        </View>
      );
    }
    if (pageError) {
      return (
        <View style={[s.footer, { height: itemHeight }]}>
          <ErrorBox message={pageError} onRetry={loadMore} />
        </View>
      );
    }
    return null;
  }, [loadingMore, pageError, itemHeight, loadMore, s, c.w50]);

  const getItemLayout = useCallback(
    (_: ArrayLike<Clip> | null | undefined, index: number) => ({
      length: itemHeight,
      offset: itemHeight * index,
      index,
    }),
    [itemHeight]
  );

  return (
    <View
      style={s.root}
      onLayout={(e) => setItemHeight(Math.round(e.nativeEvent.layout.height))}
    >
      {/* The picture is dark whatever the device scheme, so the clock must stay light. */}
      <StatusBar style="light" />
      {itemHeight > 0 && videos.length > 0 ? (
        <FlatList
          ref={listRef}
          data={videos}
          keyExtractor={(v) => v.id}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          pagingEnabled
          snapToInterval={itemHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
          removeClippedSubviews
          onEndReached={loadMore}
          // Two screens of runway, so the next page has landed — and the pool has
          // preloaded its first clip — before the reader swipes onto it.
          onEndReachedThreshold={2}
          ListFooterComponent={footer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => reload({ pull: true })}
              tintColor="rgba(255,255,255,0.6)"
            />
          }
        />
      ) : null}

      {loading && videos.length === 0 ? (
        <View style={s.centre}>
          <ActivityIndicator color={c.w50} />
        </View>
      ) : null}

      {!loading && videos.length === 0 && !error ? (
        <View style={s.centre}>
          <Text style={s.empty}>
            Nothing published yet.{"\n"}Add clips with scripts/media/add-local.sh, or publish a
            draft from My videos.
          </Text>
          <Pressable onPress={() => reload()} style={s.retry}>
            <Text style={s.retryText}>Reload</Text>
          </Pressable>
        </View>
      ) : null}

      {/*
        A failed first load owns the screen — there is nothing behind the banner to read,
        and showing it over the "nothing published yet" copy said two contradictory things
        at once. Once clips are loaded the same failure is only a banner, so the feed the
        reader is watching stays watchable.
      */}
      {error && videos.length === 0 ? (
        <View style={s.centre}>
          <ErrorBox message={error} onRetry={() => reload()} fullScreen />
        </View>
      ) : null}

      {error && videos.length > 0 ? (
        <View style={[s.banner, { top: insets.top + 12 }]}>
          <ErrorBox message={error} onRetry={() => reload()} />
        </View>
      ) : null}

      {/*
        Design 2a's feed switch. It lives here rather than in FeedItem because it belongs to
        the feed, not to a row — one instance over the list, not one per clip.

        There is no follow graph on the server: no relation, no endpoint, nothing that could
        answer "whose clips do I follow". So "For you" is the only reachable state, and
        "Following" renders as the tab it will be rather than as a control that would return
        the same list under a different name.
      */}
      {videos.length > 0 ? (
        <View pointerEvents="none" style={[s.feedTabs, { top: insets.top + 10 }]}>
          <Text style={s.feedTab}>Following</Text>
          <Text style={[s.feedTab, s.feedTabActive]}>For you</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: "#000" },
  footer: { width: "100%", alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  centre: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  empty: {
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    color: c.w42,
  },
  retry: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.w18,
  },
  retryText: { fontFamily: font.sans, fontSize: 12.5, fontWeight: "500", color: c.textButton },
  // `top` is supplied at render from the safe-area inset — the feed draws under the status bar.
  banner: { position: "absolute", left: 16, right: 16 },
  feedTabs: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 26,
  },
  feedTab: {
    fontFamily: font.sans,
    fontSize: 13.5,
    fontWeight: "600",
    color: c.w50,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
  feedTabActive: { fontSize: 15, color: "#FFFFFF" },
}));
