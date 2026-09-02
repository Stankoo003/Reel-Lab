// Profile — the acting user, their video library, plus live backend health.
//
// Design 3a folds My videos into this page as a segmented section rather than a peer tab,
// so the library sits under the identity it belongs to. That is why this screen is one
// FlatList: the header, the grid and the settings blocks scroll as a single column, and a
// grid nested inside a ScrollView would be a second scroll container.
//
// The health check is the acceptance criterion "app calls the backend health endpoint from
// a device". It is a typed call like any other, because springdoc.show-actuator puts
// /actuator/health in the published contract.
import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { getHealth, getProfile } from "../../api/client";
import { errorMessage } from "../../src/errors";
import { fetchMyVideos } from "../../src/library";
import { useClips } from "../../src/state/ClipsContext";
import ProfileCard from "../../src/profile/ProfileCard";
import VideoTile from "../../src/profile/VideoTile";
import Card from "../../src/ui/Card";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";
import Segmented from "../../src/ui/Segmented";
import { API_BASE_URL, MEDIA_BASE_URL, APP_ENV } from "../../api/config";
import { useAuth } from "../../src/state/AuthContext";
import type { Health, Profile } from "../../api/client";
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
  const { clips, selectClip } = useClips();
  const { user: me, signOut } = useAuth();

  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [user, setUser] = useState<Profile | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Clip[]>([]);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("videos");

  const load = useCallback(async () => {
    setLoading(true);
    setHealthError(null);
    setUserError(null);
    setVideosError(null);
    // Independent: a healthy backend with a missing user should still show health.
    try {
      setHealth(await getHealth());
    } catch (e) {
      setHealth(null);
      setHealthError(errorMessage(e));
    }
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

  const up = health?.status === "UP";
  const dbStatus = health?.components?.db?.status;

  function open(clip: Clip) {
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
        {isIOS ? <Text style={s.topAction}>Settings</Text> : null}
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
        {isIOS ? null : <Text style={s.topAction}>⋮</Text>}
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

  const footer = (
    <View style={s.footer}>
      <Card title="Account">
        <Row label="ID" value={user?.id ?? "—"} />
        <Text style={[type.note, s.footnote]}>
          Signed in with a token held in the device keychain. The server takes your identity
          from it rather than from anything this app sends, so a request cannot claim to be
          someone else. No endpoint returns an email or a credential, including this one.
        </Text>
        <Button
          label="Sign out"
          onPress={signOut}
          size="compact"
          style={s.recheck}
        />
      </Card>

      <Card
        title="Backend health"
        accessory={
          <View style={[s.pill, { backgroundColor: up ? c.successBg : c.recBg }]}>
            <Text style={[type.badge, { color: up ? c.success : c.recText }]}>
              {up ? "UP" : (health?.status ?? "UNREACHABLE")}
            </Text>
          </View>
        }
      >
        <Row label="ENDPOINT" value={`${API_BASE_URL}/actuator/health`} />
        {dbStatus ? (
          <Row label="DATABASE" value={dbStatus} tint={dbStatus === "UP" ? c.success : c.recText} />
        ) : null}
        {healthError ? <Text style={[type.note, { color: c.recText }]}>{healthError}</Text> : null}
        <Button label="Check again" onPress={load} size="compact" style={s.recheck} />
      </Card>

      <Card title="Environment">
        <Row label="APP ENV" value={APP_ENV} />
        <Row label="API BASE" value={API_BASE_URL} />
        <Row label="MEDIA BASE" value={MEDIA_BASE_URL} />
        <Text style={[type.note, s.footnote]}>
          Set per environment via .env / .env.development / .env.production, inlined at build
          time.
        </Text>
      </Card>
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
        ListFooterComponent={footer}
        renderItem={({ item }) => <VideoTile clip={item} onPress={open} />}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={c.w50} />
        }
      />
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
  footer: { paddingHorizontal: 18, paddingTop: 14, gap: 14 },
  row: { gap: 3 },
  rowValue: { fontFamily: font.mono, fontSize: 12, color: c.text },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  footnote: { marginTop: 2 },
  recheck: { marginTop: 4 },
}));
