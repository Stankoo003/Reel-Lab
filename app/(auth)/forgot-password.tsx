// Ask for a reset link.
//
// The screen's one unusual property: it says the same thing whether or not the address has
// an account. That is not vagueness — it is the client half of the server's rule. An app
// that showed "no account with that email" would hand back the account-enumeration oracle
// the endpoint goes to some trouble to deny; see PasswordResetService on the server.
import { useState } from "react";
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../../src/theme";
import { emailError } from "../../src/auth";
import { errorMessage } from "../../src/errors";
import { requestPasswordReset } from "../../api/client";
import AuthField from "../../src/ui/AuthField";
import Button from "../../src/ui/Button";
import ErrorBox from "../../src/ui/ErrorBox";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { type } = useTheme();
  const s = useStyles();

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const local = emailError(email);
  const shown = submitted ? local : undefined;

  async function submit() {
    setSubmitted(true);
    setFormError(null);
    if (local || submitting) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e) {
      // A rate limit is the only thing that lands here, and it is honest to show: it is a
      // fact about how often THIS phone has asked, not about whether the address exists.
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={s.fill} behavior={isIOS ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text style={type.action}>Back</Text>
          </Pressable>

          {sent ? (
            <>
              <Text style={[type.authTitle, s.title]}>Check your email</Text>
              {/*
                Deliberately worded so it is true either way. "We sent you a link" would be a
                lie for an address with no account — and a lie a stranger could use to find
                out which addresses are registered.
              */}
              <Text style={s.subtitle}>
                If {email.trim()} has an account, a reset link is on its way. It works once
                and expires in about 45 minutes.
              </Text>
              <Text style={[type.note, s.note]}>
                Nothing arrived? Check spam, then try again in a few minutes — asking twice
                cancels the first link.
              </Text>

              <Button
                label="Back to sign in"
                variant="primary"
                style={s.submit}
                onPress={() => router.back()}
              />
            </>
          ) : (
            <>
              <Text style={[type.authTitle, s.title]}>Reset your password</Text>
              <Text style={s.subtitle}>
                Enter the email you signed up with and we will send a link to set a new
                password.
              </Text>

              <View style={s.fields}>
                <AuthField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  error={shown}
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  autoFocus
                />
              </View>

              {formError ? (
                <View style={s.formError}>
                  <ErrorBox message={formError} />
                </View>
              ) : null}

              <Button
                label={submitting ? "Sending…" : "Send reset link"}
                variant="primary"
                disabled={submitting}
                style={s.submit}
                onPress={submit}
              />
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
  note: { marginTop: 16 },
  fields: { marginTop: 30, gap: 14 },
  formError: { marginTop: 16 },
  submit: { marginTop: 22 },
}));
