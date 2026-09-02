import { useEffect } from "react";
import { Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import EditorScreen from "../src/screens/EditorScreen";
import { canEdit } from "../src/library";
import { useClips } from "../src/state/ClipsContext";
import { font, themedStyles } from "../src/theme";

export default function EditorRoute() {
  const router = useRouter();
  const { clip, settings, setSettings, error, setError } = useClips();
  const s = useStyles();

  // Also checked where the editor is opened from; repeated here so a new caller cannot
  // route around the rule. Navigation is a side effect, so it runs from an effect
  // rather than mid-render — replacing during render trips React's update-in-render
  // warning and can race the router's own mount.
  const invalid = !clip || !settings || !canEdit(clip);
  useEffect(() => {
    if (invalid) router.replace("/");
  }, [invalid, router]);

  if (invalid) return null;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <EditorScreen
        clip={clip}
        settings={settings}
        setSettings={setSettings}
        onCancel={() => router.back()}
        onExport={() => router.push("/export")}
      />
      {error ? (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <Text style={s.errorText} numberOfLines={5}>
            {error}
          </Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({
  root: { flex: 1, backgroundColor: c.bg },
  errorBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 20,
    padding: 13,
    borderRadius: 10,
    backgroundColor: c.recBg,
    borderWidth: 1,
    borderColor: c.recBorder,
  },
  errorText: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 16, color: c.recText },
}));
