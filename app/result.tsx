import { useEffect } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import ResultScreen from "../src/screens/ResultScreen";
import { useClips } from "../src/state/ClipsContext";
import { themedStyles } from "../src/theme";

export default function ResultRoute() {
  const router = useRouter();
  const { result, settings } = useClips();
  const s = useStyles();

  // From an effect, not mid-render — navigation is a side effect.
  useEffect(() => {
    if (!result) router.replace("/");
  }, [result, router]);

  if (!result) return null;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <ResultScreen
        result={result}
        settings={settings}
        onPost={() => router.push("/post")}
        onDone={() => router.dismissTo("/(tabs)/profile")}
      />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({ root: { flex: 1, backgroundColor: c.bg } }));
