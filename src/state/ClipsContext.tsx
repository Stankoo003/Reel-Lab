// Shared editor state.
//
// Routes cannot share a useState the way the old single-screen App.js did, so the
// clip library, the staged edit settings and the export run live here instead. This
// is a mechanical extraction of what App.js already owned — not a rewrite.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { adoptClip, restoreClips } from "../clips";
import { errorMessage } from "../errors";
import { runExport } from "../export";
import { materialiseForExport } from "../library";
import type { Clip, ClipOrigin, EditSettings, ExportSuccess } from "../types";

export type ClipsValue = {
  /** Everything loaded or captured this session, newest first. */
  clips: Clip[];
  /** The clip the editor is working on. */
  clip: Clip | null;
  settings: EditSettings | null;
  setSettings: Dispatch<SetStateAction<EditSettings | null>>;
  /** Only ever a successful export — a failure lands in `error` instead. */
  result: ExportSuccess | null;
  error: string | null;
  setError: (error: string | null) => void;
  selectClip: (clip: Clip | null) => void;
  addClip: (uri: string, origin: ClipOrigin) => Promise<Clip>;
  /** Resolves to the result, or null if the export failed. */
  startExport: () => Promise<ExportSuccess | null>;
};

/** The running export's ticker. See ExportProgressContext for why it is separate. */
export type ExportProgress = {
  /** Encode progress, 0…1. */
  progress: number;
  /** Seconds since the export started. */
  elapsed: number;
};

const ClipsContext = createContext<ClipsValue | null>(null);

// Separate from ClipsContext on purpose: the ticker updates every 100ms (plus FFmpeg's
// own statistics callback) for the whole export, and a single context carrying both
// re-rendered every consumer — the mounted Feed and My-videos tabs included — on every
// tick. Split out, only the Export screen subscribes to the ticks.
const ExportProgressContext = createContext<ExportProgress>({ progress: 0, elapsed: 0 });

export const defaultSettings = (clip: Clip | null): EditSettings => ({
  trimIn: 0,
  trimOut: clip?.duration || 5,
  text: "",
  textPosition: "lower",
  textSize: "M",
  textColor: "#FFFFFF",
  music: false,
  musicGainDb: -6,
  originalGainDb: -18,
});

export function ClipsProvider({ children }: { children: ReactNode }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [clip, setClip] = useState<Clip | null>(null);
  const [settings, setSettings] = useState<EditSettings | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ExportSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /**
   * Bring back what earlier sessions recorded or imported.
   *
   * Clips are copied into app-private document storage (see `adoptClip`), so the FILES
   * outlive the process — but this list does not, and without a restore the library looked
   * empty after every relaunch. Appended rather than replacing, because a clip captured
   * while the scan was still running must not be dropped.
   */
  useEffect(() => {
    let alive = true;
    restoreClips()
      .then((restored) => {
        if (!alive || restored.length === 0) return;
        setClips((prev) => {
          const known = new Set(prev.map((c) => c.id));
          return [...prev, ...restored.filter((c) => !known.has(c.id))];
        });
      })
      .catch(() => {
        // An unreadable clips directory is not worth an error banner on launch; capture
        // and import both still work, and they recreate it.
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectClip = useCallback((next: Clip | null) => {
    setClip(next);
    setSettings(defaultSettings(next));
    setError(null);
  }, []);

  const addClip = useCallback(
    async (uri: string, origin: ClipOrigin) => {
      const next = await adoptClip(uri, origin);
      setClips((prev) => [next, ...prev]);
      selectClip(next);
      return next;
    },
    [selectClip]
  );

  /** Pull the library from the API. Clips keep their remote CDN URL for playback. */
  const startExport = useCallback(async () => {
    if (busy.current || !clip || !settings) return null;
    busy.current = true;
    setProgress(0);
    setElapsed(0);
    setResult(null);
    const started = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    try {
      // A library clip streams from the CDN for playback, but FFmpeg needs a local
      // file — download it now rather than at load time.
      const local = await materialiseForExport(clip);
      const r = await runExport({ ...settings, sourceUri: local.uri }, { onProgress: setProgress });
      if (!r.ok) {
        setError(r.error ?? "export failed");
        return null;
      }
      const done = { ...r, ms: Date.now() - started };
      setResult(done);
      return done;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      clearInterval(tick);
      busy.current = false;
    }
  }, [clip, settings]);

  // Memoised, and deliberately free of the ticker: the ticks live in their own context
  // below, so a running export re-renders the Export screen and nothing else.
  const value: ClipsValue = useMemo(
    () => ({
      clips,
      clip,
      settings,
      setSettings,
      result,
      error,
      setError,
      selectClip,
      addClip,
      startExport,
    }),
    [clips, clip, settings, result, error, selectClip, addClip, startExport]
  );

  const ticker: ExportProgress = useMemo(() => ({ progress, elapsed }), [progress, elapsed]);

  return (
    <ClipsContext.Provider value={value}>
      <ExportProgressContext.Provider value={ticker}>{children}</ExportProgressContext.Provider>
    </ClipsContext.Provider>
  );
}

export function useClips() {
  const ctx = useContext(ClipsContext);
  if (!ctx) throw new Error("useClips must be used inside <ClipsProvider>");
  return ctx;
}

/** The running export's progress and elapsed time. Subscribes to every tick — only the
 *  Export screen should want this. */
export function useExportProgress(): ExportProgress {
  return useContext(ExportProgressContext);
}
