// Create — record a clip, or import one.
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import CameraScreen from "../../src/screens/CameraScreen";
import { useClips } from "../../src/state/ClipsContext";
import { errorMessage } from "../../src/errors";
import { FixedTheme, button, font, isIOS, themedStyles, useTheme } from "../../src/theme";
import type { ClipOrigin } from "../../src/types";

/** The viewfinder is a picture surface: dark in both schemes, like the feed. */
export default function CreateRoute() {
  return (
    <FixedTheme scheme="dark">
      <CreateScreen />
    </FixedTheme>
  );
}

function CreateScreen() {
  const router = useRouter();
  const { addClip } = useClips();
  const { c } = useTheme();
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);

  async function accept(uri: string, origin: ClipOrigin) {
    try {
      await addClip(uri, origin);
      router.push("/editor");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function importFromGallery() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (r.canceled) return;
      await accept(r.assets[0].uri, "gallery");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      {/* Viewfinder is black in both schemes — see FixedTheme above. */}
      <StatusBar style="light" />
      <CameraScreen onClip={(uri) => accept(uri, "camera")} onOpenClips={importFromGallery} />
      <View style={s.footer}>
        <Pressable onPress={importFromGallery} style={s.secondary}>
          <Text style={[button.labelStyle, { color: c.textButton }]}>
            {button.label("Import from gallery")}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <Text style={s.errorText} numberOfLines={4}>
            {error}
          </Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bgCamera },
  footer: { paddingHorizontal: 16, paddingBottom: isIOS ? 6 : 12, backgroundColor: c.bg },
  secondary: {
    height: button.height,
    borderRadius: button.radius,
    borderWidth: 1,
    borderColor: c.w18,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 90,
    padding: 13,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
  },
  errorText: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 16, color: c.recText },
}));
