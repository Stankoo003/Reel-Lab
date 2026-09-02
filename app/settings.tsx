// Settings — the account, and the diagnostics that used to sit under the profile grid.
//
// Moved off the profile on purpose. Design 3a ends that page with the video grid; three
// cards of IDs, URLs and health states below it made the profile read like a debug console
// and buried the thing people actually came for. They are still one tap away, behind the
// "Settings" control the design already puts in the profile's top row.
//
// The health check is the acceptance criterion "app calls the backend health endpoint from
// a device". It is a typed call like any other, because springdoc.show-actuator puts
// /actuator/health in the published contract.
import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../src/theme";
import { getHealth } from "../api/client";
import { errorMessage } from "../src/errors";
import { useAuth } from "../src/state/AuthContext";
import Card from "../src/ui/Card";
import Button from "../src/ui/Button";
import { API_BASE_URL, MEDIA_BASE_URL, APP_ENV } from "../api/config";
import type { Health } from "../api/client";

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

export default function SettingsScreen() {
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { user, signOut } = useAuth();

  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setHealthError(null);
    try {
      setHealth(await getHealth());
    } catch (e) {
      setHealth(null);
      setHealthError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const up = health?.status === "UP";
  const dbStatus = health?.components?.db?.status;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Text style={type.sectionTitle}>Settings</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.body}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={check} tintColor={c.w50} />}
      >
        <Card title="Account">
          <Row label="SIGNED IN AS" value={user?.username ? `@${user.username}` : "—"} />
          <Row label="ID" value={String(user?.id ?? "—")} />
          <Text style={[type.note, s.footnote]}>
            Signed in with a token held in the device keychain. The server takes your identity
            from it rather than from anything this app sends, so a request cannot claim to be
            someone else. No endpoint returns an email or a credential, including this one.
          </Text>
          <Button label="Sign out" onPress={signOut} size="compact" style={s.action} />
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
          <Button label="Check again" onPress={check} size="compact" style={s.action} />
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
      </ScrollView>
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
  body: { paddingHorizontal: 18, paddingBottom: 28, gap: 14 },
  row: { gap: 3 },
  rowValue: { fontFamily: font.mono, fontSize: 12, color: c.text },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  footnote: { marginTop: 2 },
  action: { marginTop: 4 },
}));
