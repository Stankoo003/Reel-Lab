// Sign in — email and password.
//
// Nothing is sent and nothing is checked; see app/(auth)/_layout.tsx. "Sign in" enters the
// app once the form is filled in, because that is as far as the app can honestly go.
import { useState } from "react";
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { button, font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { emailError, passwordError } from "../../src/auth";
import { errorMessage } from "../../src/errors";
import { useAuth } from "../../src/state/AuthContext";
import AuthField from "../../src/ui/AuthField";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";
import { ValidationError } from "../../api/client";

export default function LoginScreen() {
  const router = useRouter();
  const { type } = useTheme();
  const s = useStyles();

  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Errors appear on the first submit, not while typing — flagging an address as malformed
  // after two characters is noise, not help.
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The server's answer. A wrong password is not attached to either field: the server does
   *  not say which one was wrong, and guessing would be inventing information. */
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const local = { email: emailError(email), password: passwordError(password) };
  const shown = submitted
    ? { email: local.email ?? fieldErrors.email, password: local.password ?? fieldErrors.password }
    : { email: undefined, password: undefined };

  async function submit() {
    setSubmitted(true);
    setFormError(null);
    setFieldErrors({});
    if (local.email || local.password || submitting) return;
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      // No navigation here. The gate in app/_layout.tsx redirects to the feed as soon as the
      // session exists; navigating here as well would race it.
    } catch (e) {
      // Per-field messages when the server sent any; otherwise the sentence it did send.
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
          <View style={s.mark}>
            <Text style={s.markGlyph}>▸</Text>
          </View>

          <Text style={[type.authTitle, s.title]}>Sign in to keep your clips</Text>
          <Text style={s.subtitle}>Your email and password. Nothing else to remember.</Text>

          <View style={s.fields}>
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
              placeholder="Your password"
              error={shown.password}
              secure
              autoComplete="current-password"
              textContentType="password"
            />
          </View>

          <Pressable style={s.forgot} accessibilityRole="button" onPress={() => {}}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </Pressable>

          {formError ? <View style={s.formError}><ErrorBox message={formError} /></View> : null}

          <Button
            label={submitting ? "Signing in…" : "Sign in"}
            variant="primary"
            disabled={submitting}
            style={s.submit}
            onPress={submit}
          />

          <View style={s.divider}>
            <View style={s.rule} />
            <Text style={s.or}>OR</Text>
            <View style={s.rule} />
          </View>

          {/*
            The platform's own identity provider, as the design names it. Inert — there is no
            backend to hand a token to.
          */}
          <Pressable style={[s.alt, s.altSolid]} accessibilityRole="button" onPress={() => {}}>
            <Text style={[s.altLabel, s.altSolidLabel]}>
              {button.label(isIOS ? "Continue with Apple" : "Continue with Google")}
            </Text>
          </Pressable>

          <View style={s.spacer} />

          <Pressable
            onPress={() => router.push("/(auth)/signup")}
            accessibilityRole="button"
            hitSlop={8}
            style={s.footer}
          >
            <Text style={s.footerText}>
              New here? <Text style={s.footerLink}>Create an account</Text>
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
  mark: {
    marginTop: isIOS ? 40 : 36,
    width: 46,
    height: 46,
    borderRadius: isIOS ? 12 : 14,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  markGlyph: { fontFamily: font.mono, fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
  title: { marginTop: isIOS ? 26 : 24 },
  subtitle: { marginTop: 10, fontFamily: font.sans, fontSize: 14, lineHeight: 21, color: c.w50 },
  fields: { marginTop: isIOS ? 34 : 32, gap: 14 },
  forgot: { marginTop: 12, alignSelf: "flex-end" },
  forgotText: { fontFamily: font.sans, fontSize: 12.5, color: c.accentSoft },
  formError: { marginTop: 16 },
  submit: { marginTop: 18 },
  divider: { flexDirection: "row", alignItems: "center", gap: 14, marginVertical: isIOS ? 28 : 26 },
  rule: { flex: 1, height: 1, backgroundColor: c.w08 },
  or: { fontFamily: font.mono, fontSize: 10.5, letterSpacing: 1.05, color: c.w35 },
  alt: {
    height: button.height,
    borderRadius: button.radius,
    alignItems: "center",
    justifyContent: "center",
  },
  // The design inverts this one — the platform button is the loudest thing on the screen
  // after the accent, so it takes the text colour as its fill.
  altSolid: { backgroundColor: c.text },
  altSolidLabel: { color: c.bg },
  altLabel: { ...button.labelStyle, fontSize: isIOS ? 14.5 : 13.5, color: c.textButton },
  spacer: { flex: 1, minHeight: 24 },
  footer: { alignSelf: "center" },
  footerText: { fontFamily: font.sans, fontSize: 12.5, color: c.w42 },
  footerLink: { color: c.accentSoft, fontWeight: "600" },
}));
