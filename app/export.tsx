import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import ExportScreen from "../src/screens/ExportScreen";
import { useClips, useExportProgress } from "../src/state/ClipsContext";
import { themedStyles } from "../src/theme";

export default function ExportRoute() {
  const router = useRouter();
  const { clip, settings, startExport } = useClips();
  const { progress, elapsed } = useExportProgress();
  const started = useRef(false);
  const s = useStyles();

  useEffect(() => {
    if (started.current || !clip || !settings) return;
    started.current = true;
    startExport().then((r) => {
      // On failure the provider sets `error`, which the editor surfaces.
      router.replace(r ? "/result" : "/editor");
    });
  }, [clip, settings, startExport, router]);

  // From an effect, not mid-render — navigation is a side effect.
  const invalid = !clip || !settings;
  useEffect(() => {
    if (invalid) router.replace("/");
  }, [invalid, router]);

  if (invalid) return null;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <ExportScreen
        clip={clip}
        settings={settings}
        progress={progress}
        elapsed={elapsed}
        onCancel={() => router.replace("/editor")}
      />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ c }) => ({ root: { flex: 1, backgroundColor: c.bg } }));
