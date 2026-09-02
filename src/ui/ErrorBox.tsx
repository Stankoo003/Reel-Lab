// The tap-to-retry error panel, in one place.
//
// It was seven near-copies across the app, each hardcoding the same rgba pair — except the
// feed's, which had drifted to different values — while the theme already carried a `recBg`
// token that only one screen used.
import { View, Text, Pressable } from "react-native";
import { font, themedStyles, useTheme } from "../theme";

export default function ErrorBox({
  message,
  onRetry,
  /** Owns the screen, for a failure with nothing behind it to read. */
  fullScreen = false,
}: {
  message: string;
  onRetry?: () => void;
  fullScreen?: boolean;
}) {
  const { type } = useTheme();
  const s = useStyles();

  if (fullScreen) {
    return (
      <View style={s.centre}>
        <Text style={s.centreText}>{message}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} style={s.retry} accessibilityRole="button">
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const body = (
    <>
      <Text style={s.text}>{message}</Text>
      {onRetry ? <Text style={type.note}>Tap to retry.</Text> : null}
    </>
  );
  return onRetry ? (
    <Pressable onPress={onRetry} style={s.box} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    <View style={s.box}>{body}</View>
  );
}

const useStyles = themedStyles(({ c, type }) => ({
  box: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
    gap: 4,
  },
  text: { ...type.error },
  centre: { alignItems: "center", justifyContent: "center", gap: 16, padding: 32, flex: 1 },
  centreText: { ...type.note, textAlign: "center" },
  retry: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.w18,
  },
  retryText: { fontFamily: font.sans, fontSize: 12.5, fontWeight: "500", color: c.textButton },
}));
