// Set a new password from a reset link.
//
// Reached two ways, and both matter:
//   • the deep link reellab://reset-password?token=… , which the web page hands over when
//     the app is installed
//   • from the forgot-password screen, for someone who has the email open beside them and
//     would rather type the token than switch apps
//
// It does NOT sign you in afterwards. The server answers a reset with a message rather than
// a session on purpose: signing in with the new password is what proves it is the one you
// meant to set, and a link that granted a session would be worth more to whoever intercepted
// it.
import { useState } from "react";
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { passwordError } from "../../src/auth";
import { errorMessage } from "../../src/errors";
import { resetPassword } from "../../api/client";
import AuthField from "../../src/ui/AuthField";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { type } = useTheme();
  const s = useStyles();
  const params = useLocalSearchParams<{ token?: string }>();

  // Prefilled from the link, editable when there was none. A field the user cannot see is a
  // field they cannot fix when the link arrives mangled by a mail client.
  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const local = {
    token: token.trim() ? undefined : "Paste the token from your reset email",
    password: passwordError(password),
    // Checked here rather than on the server: the server has only one password to look at,
    // so "they do not match" is a question only this screen can answer.
    confirm: confirm === password ? undefined : "The two passwords do not match",
  };
  const shown = submitted ? local : { token: undefined, password: undefined, confirm: undefined };

  async function submit() {
    setSubmitted(true);
    setFormError(null);
    if (local.token || local.password || local.confirm || submitting) return;
    setSubmitting(true);
    try {
      await resetPassword(token.trim(), password);
      setDone(true);
    } catch (e) {
      // Expired, already used, or never issued — the server's own sentence, which is
      // written to tell those apart only where doing so is safe.
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={s.fill} behavior={isIOS ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => router.replace("/(auth)/login")}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={type.action}>Sign in</Text>
          </Pressable>

          {done ? (
            <>
              <Text style={[type.authTitle, s.title]}>Password changed</Text>
              <Text style={s.subtitle}>
                Sign in with your new password. Anywhere you were already signed in has been
                signed out.
              </Text>
              <Button
                label="Go to sign in"
                variant="primary"
                style={s.submit}
                onPress={() => router.replace("/(auth)/login")}
              />
            </>
          ) : (
            <>
              <Text style={[type.authTitle, s.title]}>Choose a new password</Text>
              <Text style={s.subtitle}>
                The link you followed works once, and only for a little while.
              </Text>

              <View style={s.fields}>
                {/* Shown, not hidden, even when it came from the link — a token you can see
                    is one you can check against the email when something goes wrong. */}
                <AuthField
                  label="Reset token"
                  value={token}
                  onChangeText={setToken}
                  placeholder="From your reset email"
                  error={shown.token}
                  autoComplete="off"
                />
                <AuthField
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  error={shown.password}
                  secure
                  autoComplete="new-password"
                  textContentType="newPassword"
                  autoFocus={Boolean(params.token)}
                />
                <AuthField
                  label="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Type it again"
                  error={shown.confirm}
                  secure
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
              </View>

              {formError ? (
                <View style={s.formError}>
                  <ErrorBox message={formError} />
                </View>
              ) : null}

              <Button
                label={submitting ? "Changing…" : "Change password"}
                variant="primary"
                disabled={submitting}
                style={s.submit}
                onPress={submit}
              />

              <Pressable
                onPress={() => router.replace("/(auth)/forgot-password")}
                hitSlop={8}
                accessibilityRole="button"
                style={s.footer}
              >
                <Text style={s.footerText}>
                  Link expired? <Text style={s.footerLink}>Ask for a new one</Text>
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  fill: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: isIOS ? 26 : 22, paddingTop: 8, paddingBottom: 40 },
  title: { marginTop: 26 },
  subtitle: { marginTop: 10, fontFamily: font.sans, fontSize: 14, lineHeight: 21, color: c.w50 },
  fields: { marginTop: 30, gap: 14 },
  formError: { marginTop: 16 },
  submit: { marginTop: 22 },
  footer: { marginTop: 22, alignItems: "center" },
  footerText: { fontFamily: font.sans, fontSize: 13, color: c.w50 },
  footerLink: { color: c.accent, fontWeight: "600" },
}));
