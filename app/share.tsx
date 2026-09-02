// Share a profile: the link as a code, and the OS share sheet.
//
// The code is what someone else's camera reads; the sheet is for sending the same link to
// someone who is not in the room. Both carry the identical URL — see src/share.ts, which is
// also where the placeholder nature of that URL is written down.
import { View, Text, Pressable, Share, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, isIOS, themedStyles, useTheme } from "../src/theme";
import { profileShareUrl } from "../src/share";
import Avatar from "../src/ui/Avatar";
import Button from "../src/ui/Button";
import QrCode from "../src/ui/QrCode";

export default function ShareScreen() {
  const router = useRouter();
  const { c, type } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const { username, displayName, avatarUrl } = useLocalSearchParams<{
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }>();

  const url = profileShareUrl(username);
  // Big enough to scan across a table, but never wider than the card it sits in.
  const qrSize = Math.min(260, width - 132);

  async function send() {
    try {
      // iOS shows `url` as a link and `message` as the accompanying text; Android has only
      // `message`, so the link goes in there for it.
      await Share.share(
        isIOS
          ? { url, message: `${displayName ?? username ?? "This profile"} on ReelLab` }
          : { message: `${displayName ?? username ?? "This profile"} on ReelLab — ${url}` }
      );
    } catch {
      // The user dismissing the sheet lands here on some platforms. Nothing to report:
      // not sharing is not a failure.
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Text style={type.sectionTitle}>Share profile</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
      </View>

      <View style={s.body}>
        <View style={s.card}>
          <Avatar uri={avatarUrl} name={displayName ?? username} size={56} tint={c.accent} />
          <Text style={s.name} numberOfLines={1}>
            {displayName ?? "—"}
          </Text>
          <Text style={s.handle}>@{username ?? "unknown"}</Text>

          {/*
            Black on white regardless of scheme. A code inverted to suit a dark UI is read by
            some scanners and silently refused by others, and the card is the one surface
            here whose job is to be machine-readable rather than to match the app.
          */}
          <View style={s.qrWell}>
            <QrCode value={url} size={qrSize} />
          </View>

          {/* Selectable, so the link can be lifted without a clipboard module — adding one
              would mean a native rebuild for a single copy button. */}
          <Text style={s.url} selectable numberOfLines={2}>
            {url}
          </Text>
        </View>

        <Text style={type.note}>
          Point a camera at the code to open this profile. The page it links to does not exist
          yet — the link is the shape the real one will take.
        </Text>

        <Button label="Share link" variant="primary" onPress={send} />
      </View>
    </SafeAreaView>
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
  body: { flex: 1, paddingHorizontal: 18, paddingBottom: 20, gap: 14 },
  card: {
    alignItems: "center",
    gap: 6,
    padding: 22,
    borderRadius: 18,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.w07,
  },
  name: { fontFamily: font.sans, fontSize: 17, fontWeight: "600", color: c.text, marginTop: 6 },
  handle: { fontFamily: font.mono, fontSize: 12, color: c.w42 },
  qrWell: {
    marginTop: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  url: { fontFamily: font.mono, fontSize: 11.5, color: c.w50, marginTop: 14, textAlign: "center" },
}));
