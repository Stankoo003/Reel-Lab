// Search — find other people on the app.
//
// One thing only, on purpose: people. Searching videos would need a different endpoint and a
// different result shape, and a tab that half-searches two things is worse than one that
// fully searches one.
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { searchUsers } from "../../api/client";
import { errorMessage, isAbort } from "../../src/errors";
import { useCurrentUserId } from "../../src/state/AuthContext";
import { clearRecent, forgetUser, loadRecent, rememberUser } from "../../src/search/recent";
import UserRow from "../../src/search/UserRow";
import ErrorBox from "../../src/ui/ErrorBox";
import type { UserSummary } from "../../api/client";

/**
 * How long typing has to stop before the app asks.
 *
 * Long enough that "aleksa" is one request rather than six, short enough that it still feels
 * like it is keeping up — a search that waits for a submit button feels broken next to every
 * other search box on the phone.
 */
const DEBOUNCE_MS = 250;

export default function SearchScreen() {
  const meId = useCurrentUserId();
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The query the list on screen actually answers — not what is being typed right now. */
  const [answered, setAnswered] = useState("");
  /** People opened from here before, newest first. Shown while the box is empty. */
  const [recent, setRecent] = useState<UserSummary[]>([]);

  // The request in flight. Kept in a ref rather than state because aborting it must not
  // itself cause a render.
  const inFlight = useRef<AbortController | null>(null);

  const run = useCallback(async (text: string) => {
    inFlight.current?.abort();
    const trimmed = text.trim();

    if (!trimmed) {
      // Back to the resting state rather than leaving the last results under an empty box,
      // which reads as "these are the matches for nothing".
      inFlight.current = null;
      setResults([]);
      setAnswered("");
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);
    try {
      const found = await searchUsers(trimmed, controller.signal);
      // A slower earlier request can still land after a newer one has replaced it. Only the
      // request that is still the current one is allowed to write to the screen.
      if (inFlight.current !== controller) return;
      setResults(found);
      setAnswered(trimmed);
    } catch (e) {
      // Cancelling the previous letter's request is how this screen works, not a failure.
      if (isAbort(e) || inFlight.current !== controller) return;
      setResults([]);
      setError(errorMessage(e));
    } finally {
      if (inFlight.current === controller) setLoading(false);
    }
  }, []);

  // Debounce lives here rather than inside `run` so that retrying an error, which calls
  // `run` directly, happens immediately instead of after another wait.
  useEffect(() => {
    const timer = setTimeout(() => run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  // Leaving the screen with a request open would resolve into an unmounted component.
  useEffect(() => () => inFlight.current?.abort(), []);

  // Read once per account. The list is kept in step from here on by the functions that
  // change it — each returns the new list — so there is no re-read after every tap.
  useEffect(() => setRecent(loadRecent(meId)), [meId]);

  function openProfile(user: UserSummary) {
    // Remembered on open rather than on search, so the list holds people you actually went
    // to see. It is also what refreshes a stored name or avatar that has changed since.
    setRecent(rememberUser(meId, user));
    // The keyboard would otherwise stay up over the profile that slides in.
    Keyboard.dismiss();
    router.push({ pathname: "/user", params: { userId: String(user.id) } });
  }

  const typing = query.trim().length > 0;
  const settled = !loading && typing && answered === query.trim();
  // One list, two sources. A second FlatList for the recents would be a second scroll
  // container on a screen that only ever shows one of them at a time.
  const showingRecent = !typing && recent.length > 0;
  const data = typing ? results : recent;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={type.screenTitle}>Search</Text>

        <View style={s.field}>
          <Text style={s.fieldIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Name or @handle"
            placeholderTextColor={c.w38}
            style={s.input}
            // A handle is not a sentence: autocapitalise and autocorrect would fight every
            // username on the server.
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            // iOS draws its own clear button inside the field; Android has none, so it gets
            // the explicit one below.
            clearButtonMode={isIOS ? "while-editing" : "never"}
          />
          {!isIOS && typing ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Text style={s.clear}>✕</Text>
            </Pressable>
          ) : null}
          {/* Beside the field rather than over the list: a spinner where the results go
              makes the results you already have disappear on every keystroke. */}
          {loading ? <ActivityIndicator size="small" color={c.w42} /> : null}
        </View>
      </View>

      <FlatList
        data={data}
        keyExtractor={(u) => String(u.id)}
        renderItem={({ item }) => (
          <UserRow
            user={item}
            onPress={openProfile}
            onRemove={
              showingRecent
                ? (u) => setRecent(forgetUser(meId, String(u.id)))
                : undefined
            }
          />
        )}
        ListHeaderComponent={
          showingRecent ? (
            <View style={s.recentHead}>
              <Text style={type.label}>RECENT</Text>
              <Pressable
                onPress={() => setRecent(clearRecent(meId))}
                hitSlop={10}
                accessibilityRole="button"
              >
                <Text style={s.clearAll}>Clear</Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        // Scrolling a list of names is a gesture that means "I am reading, not typing".
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          error ? (
            <View style={s.empty}>
              <ErrorBox message={error} onRetry={() => run(query)} />
            </View>
          ) : settled ? (
            <View style={s.empty}>
              <Text style={[type.note, s.emptyText]}>No one matches “{answered}”.</Text>
            </View>
          ) : typing ? null : (
            <View style={s.empty}>
              <Text style={[type.note, s.emptyText]}>
                Find people by their name or their @handle. The ones you open show up here.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 18, paddingTop: isIOS ? 6 : 14, paddingBottom: 12, gap: 12 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 11,
    backgroundColor: c.inset,
    borderWidth: 1,
    borderColor: c.w14,
  },
  // U+2315, not the 🔍 emoji: an emoji renders as the platform's own coloured artwork,
  // ignores `color`, and would be the only illustration on the screen. The app carries no
  // icon set, and the tab bar's SF symbols are not reachable from inside a view.
  fieldIcon: { fontFamily: font.sans, fontSize: 17, color: c.w42 },
  input: { flex: 1, fontFamily: font.sans, fontSize: 14, color: c.text, padding: 0 },
  clear: { fontFamily: font.sans, fontSize: 13, color: c.w42 },
  list: { paddingBottom: 28, paddingTop: 2 },
  recentHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 8,
  },
  clearAll: { fontFamily: font.sans, fontSize: 12.5, color: c.w50 },
  empty: { paddingTop: 56, paddingHorizontal: 40 },
  emptyText: { textAlign: "center" },
}));
