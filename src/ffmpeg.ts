import * as FFmpegKitRN from "@nikhil-cephei/ffmpeg-kit-react-native";
import { NativeModules, Platform } from "react-native";

// Spike helper: thin wrapper over the FFmpegKit community fork.
// Static import: the package is plain ESM and Metro resolves it at bundle time.
// A missing native module surfaces as an undefined export, not a throw.

// Hardware encoders differ per platform; Android has no libx264 in this build.
export const HW = Platform.OS === "ios" ? "h264_videotoolbox" : "h264_mediacodec";

/** The whole module namespace, once it has been proven to carry the native bindings. */
type Kit = typeof FFmpegKitRN;

let kit: Kit | null = null;
let loadError: Error | null = null;

export function loadKit(): { kit: Kit | null; loadError: Error | null } {
  if (kit || loadError) return { kit, loadError };
  if (FFmpegKitRN?.FFmpegKit) {
    kit = FFmpegKitRN;
  } else {
    const keys = FFmpegKitRN ? Object.keys(FFmpegKitRN).join(",") : "<module is " + typeof FFmpegKitRN + ">";
    const nm = NativeModules?.FFmpegKitReactNativeModule;
    loadError = new Error(
      `FFmpegKit export missing. moduleKeys=[${keys}] nativeModule=${nm ? "present" : "MISSING"} ` +
        `nativeModuleKeys=[${nm ? Object.keys(nm).slice(0, 8).join(",") : ""}]`
    );
  }
  return { kit, loadError };
}


/** The slice of ffprobe's JSON the app actually reads. */
export type ProbeResult = {
  format?: { duration?: string | number; size?: string | number; [key: string]: unknown };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }>;
};

/** ffprobe -show_format -show_streams as parsed JSON, for measuring outputs. */
export async function probe(path: string): Promise<ProbeResult | null> {
  const { kit } = loadKit();
  if (!kit) return null;
  const session = await kit.FFprobeKit.execute(
    `-v quiet -print_format json -show_format -show_streams "${path}"`
  );
  try {
    return JSON.parse(await session.getOutput());
  } catch {
    return null;
  }
}

