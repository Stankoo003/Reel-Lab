// Profile — the acting user and their video library.
//
// Design 3a folds My videos into this page as a segmented section rather than a peer tab,
// so the library sits under the identity it belongs to. That is why this screen is one
// FlatList: the header, the grid and the settings blocks scroll as a single column, and a
// grid nested inside a ScrollView would be a second scroll container.
import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { getProfile } from "../../api/client";
import { errorMessage } from "../../src/errors";
import { fetchMyVideos } from "../../src/library";
import { localFootprint } from "../../src/localClips";
import { useClips } from "../../src/state/ClipsContext";
import ProfileCard from "../../src/profile/ProfileCard";
import VideoTile from "../../src/profile/VideoTile";
import ClipSheet from "../../src/profile/ClipSheet";
import Card from "../../src/ui/Card";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";
import Segmented from "../../src/ui/Segmented";
import { useAuth } from "../../src/state/AuthContext";
import type { Profile } from "../../api/client";
import type { Clip } from "../../src/types";

type Tab = "videos" | "liked" | "drafts";

function Row({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  /** Overrides the value colour — used to flag a component that is not UP. */
  tint?: string;
}) {
  const { type } = useTheme();
  const s = useStyles();

  return (
    <View style={s.row}>
      <Text style={type.label}>{label}</Text>
      <Text style={[s.rowValue, tint && { color: tint }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { clips, selectClip, removeClip } = useClips();
  const { user: me, signOut } = useAuth();

  const [user, setUser] = useState<Profile | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Clip[]>([]);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("videos");
  // The local clip being played, if any. Null closes the sheet and releases its player.
  const [preview, setPreview] = useState<Clip | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setUserError(null);
    setVideosError(null);
    try {
      // The gate keeps this screen behind a session, so an id is expected; guarding anyway
      // means a torn-down session during sign-out cannot fire a request for nobody.
      if (!me?.id) throw new Error("Not signed in.");
      setUser(await getProfile(String(me.id)));
    } catch (e) {
      setUser(null);
      setUserError(errorMessage(e));
    }
    try {
      setRemote(await fetchMyVideos());
    } catch (e) {
      setRemote([]);
      setVideosError(errorMessage(e));
    }
    setLoading(false);
  }, [me?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Locally recorded or imported clips have never been uploaded, so they only exist here —
  // they are drafts in the strongest sense.
  const local = useMemo(() => clips.filter((x) => x.origin !== "library"), [clips]);
  const published = useMemo(() => remote.filter((v) => v.published), [remote]);
  const drafts = useMemo(
    () => [...remote.filter((v) => v.published === false), ...local],
    [remote, local]
  );

  const shown = tab === "videos" ? published : tab === "drafts" ? drafts : [];
  const footprint = useMemo(() => localFootprint(local), [local]);

  /**
   * Tapping a tile.
   *
   * Every clip opens the player first, published or not. Going straight to the editor made
   * "watch what I made" impossible from the one screen that lists what you made; editing is
   * now a deliberate press on the sheet's Edit button rather than the side effect of a tap.
   */
  function open(clip: Clip) {
    setPreview(clip);
  }

  function editFromPreview(clip: Clip) {
    setPreview(null);
    selectClip(clip);
    router.push("/editor");
  }

  const header = (
    <View style={s.header}>
      {/*
        Screen chrome from the design. Share opens the profile's link as a scannable code;
        Settings and the overflow have no destination yet and are inert rather than routed
        somewhere that would 404.
      */}
      <View style={s.topRow}>
        {isIOS ? (
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={s.topAction}>Settings</Text>
          </Pressable>
        ) : null}
        <Text style={[s.handle, !isIOS && s.handleGrow]}>@{user?.username ?? "…"}</Text>
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/share",
              params: {
                username: user?.username ?? "",
                displayName: user?.displayName ?? "",
                avatarUrl: user?.avatarUrl ?? "",
              },
            })
          }
          // Absent, not inert, until the profile has loaded — there is no handle to put in
          // a link before then.
          disabled={!user}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Share this profile"
        >
          <Text style={[s.topAction, !user && s.topActionOff]}>Share</Text>
        </Pressable>
        {/* Android's overflow is where the design puts it; Settings is what is behind it. */}
        {isIOS ? null : (
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={s.topAction}>⋮</Text>
          </Pressable>
        )}
      </View>

      {user ? (
        <ProfileCard profile={user} editable onSaved={setUser} />
      ) : (
        <Card>
          <Text style={[type.note, userError ? { color: c.recText } : null]}>
            {userError ?? "loading…"}
          </Text>
        </Card>
      )}

      <View style={s.sectionHead}>
        <Text style={type.sectionTitle}>My videos</Text>
        <Text style={s.sectionMeta}>newest first</Text>
      </View>

      <Segmented
        segments={[
          { key: "videos", label: "VIDEOS", count: published.length },
          // No endpoint returns the videos a user has liked, so this segment is present and
          // empty rather than absent — the design's third state, honestly at zero.
          { key: "liked", label: "LIKED", count: 0 },
          { key: "drafts", label: "DRAFTS", count: drafts.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/*
        The DRAFTS tab mixes two genuinely different things: server drafts, which exist in
        the account and are merely unpublished, and clips that have never left this phone.
        This says so once, above the grid, so the DEVICE ONLY chips on the tiles are read
        as a category rather than as a per-tile oddity.
      */}
      {tab === "drafts" && footprint.count > 0 ? (
        <View style={s.localNote}>
          <View style={s.localHead}>
            <Text style={s.localLabel}>ON THIS DEVICE</Text>
            <Text style={s.localMeta}>{footprint.label}</Text>
          </View>
          <Text style={type.note}>
            Clips marked DEVICE ONLY are saved in this app only. They are not published, no
            one else can see them, and they carry no likes or comments. Open one to play it,
            edit it, or delete it — deleting removes the file from this device.
          </Text>
        </View>
      ) : null}

      {videosError ? <ErrorBox message={videosError} onRetry={load} /> : null}

      {shown.length === 0 && !loading && !videosError ? (
        <Text style={[type.note, s.empty]}>
          {tab === "liked"
            ? "Liked videos are not available yet."
            : tab === "drafts"
              ? "No drafts. Record something on the Create tab."
              : "Nothing published yet."}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <FlatList
        data={shown}
        keyExtractor={(v) => v.id}
        numColumns={2}
        // Remounts the list when the column count would otherwise change mid-life; also
        // makes the empty tab render its message rather than a stale grid.
        columnWrapperStyle={s.column}
        contentContainerStyle={s.body}
        ListHeaderComponent={header}
        renderItem={({ item }) => <VideoTile clip={item} onPress={open} />}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={c.w50} />
        }
      />

      {/*
        Mounted only while a clip is being previewed, so closing the sheet unmounts the
        player rather than leaving one alive behind the grid.
      */}
      {preview ? (
        <ClipSheet
          clip={preview}
          onClose={() => setPreview(null)}
          onEdit={editFromPreview}
          onDelete={removeClip}
        />
      ) : null}
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  body: { paddingBottom: 28 },
  column: { gap: 12, paddingHorizontal: 18, marginBottom: 12 },
  header: { paddingHorizontal: 18, paddingTop: isIOS ? 6 : 14, gap: 14, marginBottom: 14 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingBottom: 8,
    // iOS balances the handle between two actions; Android leads with it and trails the
    // actions, so only iOS spreads the row.
    justifyContent: isIOS ? "space-between" : "flex-start",
  },
  topAction: { fontFamily: font.sans, fontSize: isIOS ? 15 : 12.5, color: c.w55 },
  topActionOff: { color: c.w30 },
  handle: { fontFamily: font.sans, fontSize: isIOS ? 14 : 17, fontWeight: "600", color: c.text },
  // iOS centres the handle between two actions; Android leads with it.
  handleGrow: { flex: 1 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  sectionMeta: { fontFamily: font.mono, fontSize: 11.5, color: c.w38 },
  empty: { textAlign: "center", paddingVertical: 32 },
  localNote: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: c.accentBgFaint,
    borderWidth: 1,
    borderColor: c.accentBorderFaint,
  },
  localHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  localLabel: { fontFamily: font.mono, fontSize: 11, fontWeight: "500", letterSpacing: 1, color: c.accentSoft },
  localMeta: { fontFamily: font.mono, fontSize: 11, color: c.w50 },
  footer: { paddingHorizontal: 18, paddingTop: 14, gap: 14 },
  row: { gap: 3 },
  rowValue: { fontFamily: font.mono, fontSize: 12, color: c.text },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  footnote: { marginTop: 2 },
  recheck: { marginTop: 4 },
}));
