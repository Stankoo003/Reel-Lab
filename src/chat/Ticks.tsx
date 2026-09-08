// The ticks under a message you sent.
//
// One for sent, two for delivered, two in dark blue for seen — the convention every chat
// app has taught, so it needs no legend. Drawn as text rather than an icon font: a check
// mark is in every font the app ships, and a glyph cannot fail to load.
import { StyleSheet, Text, View } from "react-native";
import { font } from "../theme";
import type { MessageStatus } from "./receipts";

const LABELS: Record<MessageStatus, string> = {
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
};

/**
 * @param onAccent true when drawn inside the sender's blue bubble, where a white tick is
 *     the one that reads; on the app background the muted ink does instead
 */
export default function Ticks({
  status,
  onAccent = false,
  size = 11,
}: {
  status: MessageStatus;
  onAccent?: boolean;
  size?: number;
}) {
  const color =
    status === "seen"
      ? onAccent ? SEEN_ON_ACCENT : SEEN
      : onAccent ? "rgba(255,255,255,0.78)" : "rgba(128,128,128,0.9)";
  return (
    <View accessibilityLabel={LABELS[status]} accessible>
      <Text style={[styles.ticks, { color, fontSize: size }]}>
        {status === "sent" ? "✓" : "✓✓"}
      </Text>
    </View>
  );
}

/** Dark blue, as asked: distinct from the bubble's own blue and from the white ticks. */
const SEEN_ON_ACCENT = "#0B2F7A";
/** On the app background the same idea reads better as the accent itself. */
const SEEN = "#1F6FE5";

const styles = StyleSheet.create({
  ticks: { fontFamily: font.mono, fontWeight: "700", letterSpacing: -2 },
});
