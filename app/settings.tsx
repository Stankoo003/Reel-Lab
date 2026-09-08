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
import { changePassword, getHealth } from "../api/client";
import { errorMessage } from "../src/errors";
import { confirmError, passwordError } from "../src/auth";
import { setSession } from "../src/session";
import { useAuth } from "../src/state/AuthContext";
import AuthField from "../src/ui/AuthField";
import Card from "../src/ui/Card";
import Button from "../src/ui/Button";
import { API_BASE_URL, MEDIA_BASE_URL, APP_ENV } from "../api/config";
import { lastSocketError, socketEndpoint, socketTrail } from "../src/chat/socket";
import { useConnectionState } from "../src/chat/useConnectionState";
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
  const connection = useConnectionState();
  // Read on each render rather than subscribed: it only ever changes alongside the state
  // above, which is subscribed.
  const socketError = lastSocketError();
  const trail = socketTrail();
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

        {/*
          The socket, and why it is not connected when it is not.
          Every way this fails looks the same from the outside — a banner that says offline —
          so the endpoint it is trying and the reason it stopped are worth being able to read
          without a debugger attached.
        */}
        <Card title="Live connection">
          <Row
            label="STATE"
            value={connection.toUpperCase()}
            tint={connection === "connected" ? c.success : c.recText}
          />
          <Row label="ENDPOINT" value={socketEndpoint()} />
          {socketError ? <Row label="LAST ERROR" value={socketError} tint={c.recText} /> : null}
          {/*
            The history, newest first. One line is not enough when the question is whether
            the socket failed or was never attempted — those look identical in a single
            state, and different in a sequence.
          */}
          {trail.length ? (
            <View style={s.trail}>
              <Text style={type.label}>RECENT</Text>
              {trail.map((line) => (
                <Text key={line} style={s.trailLine} numberOfLines={2}>
                  {line}
                </Text>
              ))}
            </View>
          ) : (
            <Row label="RECENT" value="nothing — the socket has not been attempted" />
          )}
          <Text style={[type.note, s.footnote]}>
            Messages send over HTTP and are delivered over this socket. With it down, sending
            still works — what stops is other people's messages arriving without a refresh.
          </Text>
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

        <PasswordCard />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Change the password, signed in.
 *
 * The current password is asked for even though the app already holds a valid token: a
 * phone left unlocked IS a valid token, and this is the one action where that must not be
 * enough. On success the server hands back a fresh session and the old token — on every
 * device, this one included — stops working; adopting the new one here is what keeps this
 * device signed in.
 */
function PasswordCard() {
  const { c, type } = useTheme();
  const s = useStyles();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const currentLocal = current ? undefined : "Enter your current password";
  const nextLocal = passwordError(next);
  const confirmLocal = confirmError(next, confirm);
  const invalid = Boolean(currentLocal || nextLocal || confirmLocal);

  async function submit() {
    setSubmitted(true);
    setFormError(null);
    setDone(false);
    if (invalid || submitting) return;
    setSubmitting(true);
    try {
      const fresh = await changePassword(current, next);
      // The token that made this request is retired now. Adopt the new one BEFORE anything
      // else fires a request, or the next call goes out with a dead credential.
      await setSession({ token: fresh.token, userId: String(fresh.user.id) });
      setCurrent("");
      setNext("");
      setConfirm("");
      setSubmitted(false);
      setDone(true);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Password">
      <AuthField
        label="Current password"
        placeholder="Current password"
        value={current}
        onChangeText={setCurrent}
        error={submitted ? currentLocal : undefined}
        secure
        textContentType="password"
        autoComplete="current-password"
      />
      <AuthField
        label="New password"
        placeholder="New password (at least 8 characters)"
        value={next}
        onChangeText={setNext}
        error={submitted ? nextLocal : undefined}
        secure
        textContentType="newPassword"
        autoComplete="new-password"
      />
      <AuthField
        label="Confirm new password"
        placeholder="Repeat new password"
        value={confirm}
        onChangeText={setConfirm}
        error={submitted ? confirmLocal : undefined}
        secure
        textContentType="newPassword"
        autoComplete="new-password"
      />
      {formError ? <Text style={[type.note, { color: c.recText }]}>{formError}</Text> : null}
      {done ? (
        <Text style={[type.note, { color: c.success }]}>
          Password changed. Every other device has been signed out.
        </Text>
      ) : null}
      <Text style={[type.note, s.footnote]}>
        Changing it signs out every other device. This one stays signed in.
      </Text>
      <Button
        label={submitting ? "Changing…" : "Change password"}
        onPress={submit}
        size="compact"
        disabled={submitting}
        style={s.action}
      />
    </Card>
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
  trail: { gap: 3, marginTop: 4 },
  trailLine: { fontFamily: font.mono, fontSize: 10, color: c.w50 },
  action: { marginTop: 4 },
}));
