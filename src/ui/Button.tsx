// The app's button, in one place.
//
// Every screen used to declare its own `primary` / `secondary` / `ghost` block inside a
// local themedStyles factory — same three shapes, slightly different each time. The
// platform split (iOS rounded-rect sentence case, Android pill uppercase) already lived in
// the theme's `button` constant; this is what applies it.
import { Pressable, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { button, themedStyles, useTheme } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "default" | "compact";

export default function Button({
  label,
  onPress,
  variant = "secondary",
  size = "default",
  disabled = false,
  /** Fills the row it is in. Off by default so a button is only as wide as it needs to be. */
  grow = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const compact = size === "compact";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        s.base,
        compact ? s.compact : s.default,
        variant === "primary" && s.primary,
        variant === "secondary" && s.secondary,
        variant === "ghost" && s.ghost,
        grow && s.grow,
        // A disabled primary keeps its fill at a lower strength instead of going
        // translucent: the button still reads as the one that will act once it can, which
        // blanket opacity — dimming the label along with the fill — does not.
        disabled && (variant === "primary" ? s.primaryDisabled : s.disabled),
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <Text
        style={[
          compact ? s.compactLabel : s.label,
          // Filled buttons carry white text in both schemes: the accent is dark enough for
          // it in each, and flipping to the background colour would make the label vanish
          // against the light scheme's darker accent.
          {
            color:
              variant === "primary" ? (disabled ? c.w55 : "#FFFFFF") : c.textButton,
          },
        ]}
      >
        {button.label(label)}
      </Text>
    </Pressable>
  );
}

const useStyles = themedStyles(({ c }) => ({
  base: { alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  default: { height: button.height, borderRadius: button.radius },
  compact: { height: button.compactHeight, borderRadius: button.compactRadius },
  grow: { flex: 1 },
  primary: { backgroundColor: c.accent },
  secondary: { borderWidth: 1, borderColor: c.w16 },
  ghost: { backgroundColor: c.w06 },
  label: { ...button.labelStyle },
  compactLabel: { ...button.compactLabelStyle },
  primaryDisabled: { backgroundColor: c.accentBgDisabled },
  disabled: { opacity: 0.45 },
}));
