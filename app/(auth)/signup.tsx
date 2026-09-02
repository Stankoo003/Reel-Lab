// Create an account — email, password, and a repeat to catch a typo.
//
// Nothing is created; see app/(auth)/_layout.tsx. No display name is asked for here: the
// profile already has one and can edit it, so asking twice would be the signup form taking
// a decision the profile screen owns.
import { useState } from "react";
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { MIN_PASSWORD, confirmError, emailError, passwordError, usernameError } from "../../src/auth";
import { errorMessage } from "../../src/errors";
import { useAuth } from "../../src/state/AuthContext";
import AuthField from "../../src/ui/AuthField";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";
import { ValidationError } from "../../api/client";

export default function SignupScreen() {
  const router = useRouter();
  const { type } = useTheme();
  const s = useStyles();

  const { signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** "That email is already registered" arrives as a 409 sentence, not a per-field message,
   *  so it belongs above the button rather than under an input. */
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const local = {
    username: usernameError(username),
    email: emailError(email),
    password: passwordError(password),
    confirm: confirmError(password, confirm),
  };
  const shown = submitted
    ? {
        username: local.username ?? fieldErrors.username,
        email: local.email ?? fieldErrors.email,
        password: local.password ?? fieldErrors.password,
        confirm: local.confirm,
      }
    : { username: undefined, email: undefined, password: undefined, confirm: undefined };

  async function submit() {
    setSubmitted(true);
    setFormError(null);
    setFieldErrors({});
    if (local.username || local.email || local.password || local.confirm || submitting) return;
    setSubmitting(true);
    try {
      await signUp(username.trim(), email.trim(), password);
      // The gate in app/_layout.tsx redirects to the feed as soon as the session exists.
    } catch (e) {
      if (e instanceof ValidationError && Object.keys(e.fields).length > 0) {
        setFieldErrors(e.fields);
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={s.fill} behavior={isIOS ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <Text style={s.back}>{isIOS ? "← Back" : "←"}</Text>
          </Pressable>

          <Text style={[type.authTitle, s.title]}>Create your account</Text>
          <Text style={s.subtitle}>
            An email and a password of at least {MIN_PASSWORD} characters.
          </Text>

          <View style={s.fields}>
            {/*
              The handle. Asked for rather than derived from the email, because it is public:
              it is what the profile shows and what the share link carries (/@handle). Being
              handed `marko7` because `marko` was taken is worse than choosing.
            */}
            <AuthField
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="marko"
              error={shown.username}
              autoComplete="username"
              textContentType="username"
            />
            <AuthField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              error={shown.email}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <AuthField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              error={shown.password}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <AuthField
              label="Repeat password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="The same password again"
              error={shown.confirm}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
            />
          </View>

          <Text style={s.terms}>By continuing you agree to the Terms and Privacy Policy.</Text>

          {formError ? <View style={s.formError}><ErrorBox message={formError} /></View> : null}

          <Button
            label={submitting ? "Creating…" : "Create account"}
            variant="primary"
            disabled={submitting}
            style={s.submit}
            onPress={submit}
          />

          <View style={s.spacer} />

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            hitSlop={8}
            style={s.footer}
          >
            <Text style={s.footerText}>
              Already have an account? <Text style={s.footerLink}>Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  fill: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: isIOS ? 26 : 22, paddingBottom: isIOS ? 40 : 22 },
  back: { marginTop: isIOS ? 12 : 16, fontFamily: font.sans, fontSize: isIOS ? 15 : 20, color: c.w60 },
  title: { marginTop: isIOS ? 34 : 30 },
  subtitle: { marginTop: 10, fontFamily: font.sans, fontSize: 14, lineHeight: 21, color: c.w50 },
  fields: { marginTop: isIOS ? 30 : 28, gap: 14 },
  terms: { marginTop: 16, fontFamily: font.sans, fontSize: 11.5, lineHeight: 17.8, color: c.w38 },
  formError: { marginTop: 16 },
  submit: { marginTop: 18 },
  spacer: { flex: 1, minHeight: 24 },
  footer: { alignSelf: "center" },
  footerText: { fontFamily: font.sans, fontSize: 12.5, color: c.w42 },
  footerLink: { color: c.accentSoft, fontWeight: "600" },
}));
