// A labelled text input that can carry the server's message for its own field.
//
// Lifted out of ProfileCard, where it was a local component, so the auth and post forms
// get the same error treatment rather than inventing one each.
import { View, Text, TextInput } from "react-native";
import { font, themedStyles, useTheme } from "../theme";

export default function Field({
  label,
  value,
  onChangeText,
  /** The server's message for THIS field, or undefined when it is fine. */
  error,
  maxLength,
  multiline,
  placeholder,
  keyboardType,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string;
  maxLength?: number;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "number-pad" | "email-address";
  autoFocus?: boolean;
}) {
  const { c, type } = useTheme();
  const s = useStyles();

  return (
    <View style={s.field}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        style={[s.input, multiline && s.inputMultiline, error && s.inputError]}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline={multiline}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        placeholderTextColor={c.w42}
        accessibilityLabel={label.toLowerCase()}
        // Announced with the field, so the error is not merely next to it visually.
        accessibilityHint={error}
      />
      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  field: { gap: 5 },
  input: {
    fontFamily: font.sans,
    fontSize: 13,
    color: c.text,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.w18,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  // The border carries the error too — colour alone would be invisible to anyone who
  // cannot distinguish it, and the message below carries the rest.
  inputError: { borderColor: c.recText, borderWidth: 1.5 },
  error: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 15, color: c.recText },
}));
