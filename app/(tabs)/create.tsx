// Create — record a clip, or import one.
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import CameraScreen from "../../src/screens/CameraScreen";
import { useClips } from "../../src/state/ClipsContext";
import { errorMessage } from "../../src/errors";
import { FixedTheme, font, themedStyles } from "../../src/theme";
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
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);

  /**
   * Take ownership of a source clip, then open the editor.
   *
   * `addClip` → `adoptClip` copies the file into app-private document storage before this
   * returns, so neither the recorder's temp file nor the picker's cache copy is what the
   * editor goes on to read. The copy is local only — nothing on this path talks to the
   * network. Upload happens exactly once, later and deliberately, from the publish screen
   * (`app/post.tsx` → `uploadMedia`), against the exported file.
   */
  async function accept(uri: string, origin: ClipOrigin) {
    try {
      await addClip(uri, origin);
      router.push("/editor");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /**
   * Import needs no permission of ours.
   *
   * SDK 57's picker runs out of process (PHPicker / the Android photo picker), so the user
   * grants access to the one video they chose by choosing it — there is no library
   * permission to request, and nothing to deny. That is why Import stays available on the
   * camera screen even when camera and microphone are refused: it is the path that always
   * works. Cancelling is a normal outcome, not an error.
   */
  async function importFromGallery() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (r.canceled) return;
      const picked = r.assets[0]?.uri;
      if (!picked) return;
      await accept(picked, "gallery");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    /*
      A plain View, not a SafeAreaView. Design 4a runs the viewfinder full bleed, so the
      picture has to reach the screen edges; the chrome that must clear the notch and the
      tab bar is inset inside CameraScreen instead, the way the feed does it.
    */
    <View style={s.root}>
      {/* Viewfinder is black in both schemes — see FixedTheme above. */}
      <StatusBar style="light" />
      <CameraScreen onClip={(uri) => accept(uri, "camera")} onOpenClips={importFromGallery} />
      {error ? (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <Text style={s.errorText} numberOfLines={4}>
            {error}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bgCamera },
  errorBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 200,
    padding: 13,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
  },
  errorText: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 16, color: c.recText },
}));
