// The auth screens' text field.
//
// Not `Field`: that one is the compact, label-above-a-bordered-box control the profile and
// post forms use. The sign-in screens are a full-page proposition with far fewer inputs, so
// the design gives them a taller filled field — boxed on iOS, ruled along the bottom on
// Android, accent on focus in both.
import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import type { KeyboardTypeOptions, TextInputProps } from "react-native";
import { font, isIOS, themedStyles, useTheme } from "../theme";

export default function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  /** The server's message for THIS field, or undefined when it is fine. */
  error,
  secure = false,
  keyboardType,
  autoComplete,
  textContentType,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps["autoComplete"];
  textContentType?: TextInputProps["textContentType"];
  autoFocus?: boolean;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);

  return (
    <View style={s.wrap}>
      {/*
        Android carries a floating label above the rule, iOS lets the boxed field stand on
        its own — the same split the design draws. The label is still announced on both,
        via accessibilityLabel below.
      */}
      {isIOS ? null : (
        <Text style={[s.label, focused && s.labelActive, !!error && s.labelError]}>{label}</Text>
      )}

      <View style={[s.box, focused && s.boxFocused, !!error && s.boxError]}>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={c.w38}
          secureTextEntry={secure && !reveal}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoFocus={autoFocus}
          accessibilityLabel={label}
          accessibilityHint={error}
        />
        {/*
          Typing a password blind on a phone keyboard is where most sign-in attempts go
          wrong, so the field can be read back. Off by default.
        */}
        {secure ? (
          <Pressable
            onPress={() => setReveal((r) => !r)}
            hitSlop={10}
            style={s.reveal}
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
            accessibilityState={{ selected: reveal }}
          >
            <Text style={s.revealText}>{reveal ? "HIDE" : "SHOW"}</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  wrap: { gap: 5 },
  label: { fontFamily: font.sans, fontSize: 10.5, color: c.w42 },
  labelActive: { color: c.accentSoft },
  labelError: { color: c.recText },
  box: {
    flexDirection: "row",
    alignItems: "center",
    height: isIOS ? 54 : 50,
    paddingHorizontal: isIOS ? 15 : 14,
    backgroundColor: c.panel,
    borderTopLeftRadius: isIOS ? 12 : 8,
    borderTopRightRadius: isIOS ? 12 : 8,
    borderBottomLeftRadius: isIOS ? 12 : 0,
    borderBottomRightRadius: isIOS ? 12 : 0,
    borderWidth: isIOS ? 1 : 0,
    borderColor: c.w08,
    borderBottomWidth: 1,
    borderBottomColor: isIOS ? c.w08 : c.w22,
  },
  boxFocused: {
    borderColor: c.accent,
    borderWidth: isIOS ? 1.5 : 0,
    borderBottomWidth: isIOS ? 1.5 : 2,
    borderBottomColor: c.accent,
  },
  // The border carries the error too — colour alone would be invisible to anyone who
  // cannot distinguish it, and the message below carries the rest.
  boxError: {
    borderColor: c.recText,
    borderWidth: isIOS ? 1.5 : 0,
    borderBottomWidth: isIOS ? 1.5 : 2,
    borderBottomColor: c.recText,
  },
  input: { flex: 1, fontFamily: font.sans, fontSize: 15, color: c.text },
  reveal: { paddingLeft: 12 },
  revealText: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", color: c.w50 },
  error: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 15, color: c.recText },
}));
