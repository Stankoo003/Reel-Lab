// Someone else's profile, read-only.
//
// Separate route rather than a mode of the Profile tab, because they answer different
// questions: that tab is always "me", this is always "them". The one thing they share is
// ProfileCard, so the two renderings cannot drift.
import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { themedStyles, useTheme } from "../src/theme";
import { getProfile } from "../api/client";
import { useCurrentUserId } from "../src/state/AuthContext";
import { errorMessage } from "../src/errors";
import ProfileCard from "../src/profile/ProfileCard";
import ErrorBox from "../src/ui/ErrorBox";
import type { Profile } from "../api/client";

export default function UserProfileScreen() {
  const meId = useCurrentUserId();
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      setProfile(await getProfile(userId));
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

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={type.action}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {loading ? <ActivityIndicator color={c.w50} style={s.spinner} /> : null}

        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {profile ? (
          <ProfileCard profile={profile} editable={isSelf} onSaved={setProfile} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 18, paddingVertical: 12 },
  body: { paddingHorizontal: 18, paddingBottom: 28, gap: 14 },
  spinner: { marginTop: 32 },
}));
