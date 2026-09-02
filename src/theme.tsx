// Design tokens lifted from "Video Editor Spike.dc.html" (Claude Design project
// "React Native video-processing spike"), now in two schemes.
//
// The design was authored dark-only. The light palette below is derived from it by
// keeping every token's ROLE and swapping what it is made of: surfaces invert, and the
// white-alpha ramp — which carries borders and secondary text — becomes a black-alpha
// ramp. Steps up to w32 keep the same opacity; from w34 up the light values are darkened,
// because black ink at 34–45% on white falls short of the contrast the same steps carry
// on near-black. Names stay honest in both schemes: `w38` is still "the 38% ink" role,
// whichever direction the ink runs.
//
// Colours are read through useTheme() rather than imported directly, because
// StyleSheet.create runs once at import and cannot change afterwards.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Platform, StyleSheet, useColorScheme } from "react-native";
import type { TextStyle } from "react-native";

export type Scheme = "light" | "dark";

const dark = {
  // surfaces
  bg: "#0A0A0B",
  bgCamera: "#000000",
  panel: "#151518",
  inset: "#0F1013",
  note: "#101014",
  // Video wells stay dark in both schemes — letterboxing a clip against white reads as a
  // broken image, and every editor in this category keeps the picture on black.
  placeholder: "#191A1E",
  placeholderAlt: "#16171B",
  frameCell: "#1E1F24",

  // A sheet raised over playing video — the comments surface in design 2a. Deliberately
  // not `panel`: it sits above the picture rather than on the background, and the design
  // gives it its own value.
  sheet: "#141416",

  // text
  text: "#F1F2F3",
  textButton: "#E4E5E6",
  // The tab bar's unselected ink. Its own token rather than a step on the ramp, because
  // the two schemes disagree about what it is: white on the dark bar, ordinary ink on the
  // light one. See app/(tabs)/_layout.tsx.
  tabIconIdle: "#FFFFFF",

  // accent
  accent: "#4C8DF6",
  accentSoft: "#8FB8FA",
  accentNote: "#9CBEF7",
  accentBgStrong: "rgba(76,141,246,0.16)",
  accentBg: "rgba(76,141,246,0.12)",
  accentBgFaint: "rgba(76,141,246,0.09)",
  accentBorder: "rgba(76,141,246,0.5)",
  accentBorderSoft: "rgba(76,141,246,0.3)",
  accentBorderFaint: "rgba(76,141,246,0.22)",
  // A filled button that cannot yet be pressed — the "Verify" button in design 2b before
  // six digits are in. The accent stays visible, so the button still reads as the one that
  // will act; opacity on the filled style would instead read as a disabled *outline*.
  accentBgDisabled: "rgba(76,141,246,0.28)",

  // status
  success: "#57C7A3",
  successBg: "rgba(87,199,163,0.16)",
  rec: "#FF4D3D",
  recText: "#FF6B5E",
  recBg: "rgba(232,64,54,0.16)",
  recBorder: "rgba(255,77,61,0.45)",
  yellow: "#F2C230",

  // the ink ramp, named by the role it plays in the design
  w06: "rgba(255,255,255,0.06)",
  w07: "rgba(255,255,255,0.07)",
  w08: "rgba(255,255,255,0.08)",
  w10: "rgba(255,255,255,0.10)",
  w12: "rgba(255,255,255,0.12)",
  w14: "rgba(255,255,255,0.14)",
  w16: "rgba(255,255,255,0.16)",
  w18: "rgba(255,255,255,0.18)",
  w22: "rgba(255,255,255,0.22)",
  w30: "rgba(255,255,255,0.30)",
  w32: "rgba(255,255,255,0.32)",
  w34: "rgba(255,255,255,0.34)",
  w35: "rgba(255,255,255,0.35)",
  w38: "rgba(255,255,255,0.38)",
  w42: "rgba(255,255,255,0.42)",
  w45: "rgba(255,255,255,0.45)",
  w50: "rgba(255,255,255,0.50)",
  w55: "rgba(255,255,255,0.55)",
  w60: "rgba(255,255,255,0.60)",
  w70: "rgba(255,255,255,0.70)",
  w75: "rgba(255,255,255,0.75)",
  // Scrims sit on top of video, so they stay dark in both schemes.
  scrim: "rgba(10,10,11,0.66)",
  scrimSoft: "rgba(10,10,11,0.55)",
};

export type Palette = typeof dark;

const light: Palette = {
  bg: "#FFFFFF",
  bgCamera: "#000000",
  panel: "#F4F4F7",
  inset: "#F2F2F6",
  note: "#F7F7F9",
  placeholder: "#191A1E",
  placeholderAlt: "#16171B",
  frameCell: "#1E1F24",
  // Raised above `bg`, where the dark scheme's sheet is raised above near-black. The
  // comments screen currently pins itself dark (it is always over video), so this is the
  // value the role would take rather than one that renders today.
  sheet: "#FAFAFB",

  text: "#0E0E10",
  textButton: "#1B1B1F",
  // White here would vanish: the iOS bar is system glass over a light app, and Android's
  // fill follows the scheme. Same role, ordinary ink.
  //
  // Opaque, unlike the rest of the ramp. UIKit's tab-bar icon tint does not take an rgba()
  // string — it silently keeps the default, which left white icons on the light bar while
  // the label beside them went dark. This is that 56% ink already composited on white.
  tabIconIdle: "#707070",

  // Darkened against white: #4C8DF6 on white is roughly 2.9:1, below the 4.5:1 a label
  // needs. The dark scheme keeps the original, where it sits on near-black.
  accent: "#1F6FE5",
  accentSoft: "#1557B5",
  accentNote: "#2A61BC",
  accentBgStrong: "rgba(31,111,229,0.14)",
  accentBg: "rgba(31,111,229,0.10)",
  accentBgFaint: "rgba(31,111,229,0.07)",
  accentBorder: "rgba(31,111,229,0.45)",
  accentBorderSoft: "rgba(31,111,229,0.28)",
  accentBorderFaint: "rgba(31,111,229,0.20)",
  accentBgDisabled: "rgba(31,111,229,0.24)",

  success: "#12805E",
  successBg: "rgba(18,128,94,0.12)",
  rec: "#E03024",
  recText: "#BF2418",
  recBg: "rgba(232,64,54,0.12)",
  recBorder: "rgba(191,36,24,0.35)",
  yellow: "#8A6200",

  w06: "rgba(0,0,0,0.06)",
  w07: "rgba(0,0,0,0.07)",
  w08: "rgba(0,0,0,0.08)",
  w10: "rgba(0,0,0,0.10)",
  w12: "rgba(0,0,0,0.12)",
  w14: "rgba(0,0,0,0.14)",
  w16: "rgba(0,0,0,0.16)",
  w18: "rgba(0,0,0,0.18)",
  w22: "rgba(0,0,0,0.22)",
  w30: "rgba(0,0,0,0.30)",
  w32: "rgba(0,0,0,0.32)",
  w34: "rgba(0,0,0,0.42)",
  w35: "rgba(0,0,0,0.44)",
  w38: "rgba(0,0,0,0.46)",
  w42: "rgba(0,0,0,0.50)",
  w45: "rgba(0,0,0,0.52)",
  w50: "rgba(0,0,0,0.56)",
  w55: "rgba(0,0,0,0.60)",
  w60: "rgba(0,0,0,0.64)",
  w70: "rgba(0,0,0,0.72)",
  w75: "rgba(0,0,0,0.78)",
  scrim: "rgba(10,10,11,0.66)",
  scrimSoft: "rgba(10,10,11,0.55)",
};

// The design draws iOS and Android differently — this is deliberate, not noise:
// iOS uses Helvetica Neue with tight large titles and sentence-case buttons;
// Android uses Roboto with smaller titles and tracked-out uppercase buttons.
export const isIOS = Platform.OS === "ios";

export const font = {
  sans: Platform.select({ ios: "Helvetica Neue", android: "Roboto", default: "System" }),
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
};

/** letterSpacing in the design is em; RN wants px. */
const em = (value: number, size: number) => value * size;

function buildType(c: Palette) {
  return {
    // monospace — used for every number, label and machine-ish string
    label: { fontFamily: font.mono, fontSize: 9.5, letterSpacing: em(0.08, 9.5), color: c.w38 },
    badge: { fontFamily: font.mono, fontSize: 10, fontWeight: "500", letterSpacing: em(0.06, 10) },
    note: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 10.5 * 1.55, color: c.w34 },
    // Was copy-pasted into seven screens as a literal; it is a type style like any other.
    error: { fontFamily: font.mono, fontSize: 10.5, lineHeight: 16, color: c.recText },
    metaSm: { fontFamily: font.mono, fontSize: 10.5, color: c.w38 },
    meta: { fontFamily: font.mono, fontSize: 11.5, color: c.w50 },
    value: { fontFamily: font.mono, fontSize: 15, fontWeight: "500", color: c.text },
    chip: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", color: "#E8E9EA" },

    // The stat grid's number. `value` is the 15pt one used in dense rows; the profile
    // header in design 3a sets its three counts a step larger.
    statValue: { fontFamily: font.mono, fontSize: 18, fontWeight: "500", color: c.text },

    // sans — used for prose and controls
    body: { fontFamily: font.sans, fontSize: 12.5, fontWeight: "500", color: c.text },
    bodyMuted: { fontFamily: font.sans, fontSize: 12.5, color: c.w75 },
    control: { fontFamily: font.sans, fontSize: 12, fontWeight: "500", color: c.w60 },
    action: { fontFamily: font.sans, fontSize: 15, color: c.w60 },
    // Comments and the feed caption are consumer-facing rather than tool chrome, so the
    // design sets their prose a step larger than `body`.
    commentBody: { fontFamily: font.sans, fontSize: 13.5, lineHeight: 13.5 * 1.45, color: c.text },
    // A heading *inside* a screen ("My videos"), below screenTitle.
    sectionTitle: { fontFamily: font.sans, fontSize: 16, fontWeight: isIOS ? "600" : "500", color: c.text },
    profileName: isIOS
      ? { fontFamily: font.sans, fontSize: 19, fontWeight: "600", letterSpacing: em(-0.01, 19), color: c.text }
      : { fontFamily: font.sans, fontSize: 19, fontWeight: "500", color: c.text },
    screenTitle: isIOS
      ? { fontFamily: font.sans, fontSize: 30, fontWeight: "600", letterSpacing: em(-0.02, 30), color: c.text }
      : { fontFamily: font.sans, fontSize: 21, fontWeight: "500", color: c.text },
    // The auth screens are a full-page proposition rather than a titled list, so Android
    // keeps the large size here instead of dropping to screenTitle's 21pt.
    authTitle: isIOS
      ? { fontFamily: font.sans, fontSize: 30, lineHeight: 30 * 1.15, fontWeight: "600", letterSpacing: em(-0.02, 30), color: c.text }
      : { fontFamily: font.sans, fontSize: 28, lineHeight: 28 * 1.2, fontWeight: "400", color: c.text },
  } satisfies Record<string, TextStyle>;
}

export type Typography = ReturnType<typeof buildType>;

/**
 * Primary/secondary buttons differ per platform: iOS rounded-rect sentence case, Android
 * pill uppercase.
 *
 * Two sizes. `default` is the footer button that commits a screen. `compact` is the one
 * that sits inline in a header next to other content — the profile's "Edit profile" in
 * design 3a — where the full height would dominate the row it is part of.
 */
export const button = {
  radius: isIOS ? 12 : 99,
  height: isIOS ? 50 : 52,
  compactRadius: isIOS ? 11 : 99,
  compactHeight: isIOS ? 44 : 46,
  label: (text: string) => (isIOS ? text : text.toUpperCase()),
  labelStyle: isIOS
    ? { fontFamily: font.sans, fontSize: 15, fontWeight: "600" }
    : { fontFamily: font.sans, fontSize: 13, fontWeight: "500", letterSpacing: em(0.08, 13) },
  compactLabelStyle: isIOS
    ? { fontFamily: font.sans, fontSize: 14, fontWeight: "600" }
    : { fontFamily: font.sans, fontSize: 12.5, fontWeight: "500", letterSpacing: em(0.08, 12.5) },
} satisfies {
  radius: number;
  height: number;
  compactRadius: number;
  compactHeight: number;
  label: (text: string) => string;
  labelStyle: TextStyle;
  compactLabelStyle: TextStyle;
};

export type Theme = {
  scheme: Scheme;
  c: Palette;
  type: Typography;
  /** Tab pill state, straight from the design's renderVals(). */
  tabState: (active: boolean) => { backgroundColor: string; color: string };
};

function buildTheme(scheme: Scheme, c: Palette): Theme {
  return {
    scheme,
    c,
    type: buildType(c),
    tabState: (active: boolean) =>
      active
        ? { backgroundColor: c.accentBgStrong, color: c.accentSoft }
        : { backgroundColor: c.w06, color: c.w50 },
  };
}

const themes: Record<Scheme, Theme> = {
  dark: buildTheme("dark", dark),
  light: buildTheme("light", light),
};

/** null = follow the device. A subtree can pin itself with <FixedTheme>. */
const SchemeOverride = createContext<Scheme | null>(null);

/**
 * Pins a subtree to one scheme.
 *
 * Used by the surfaces that are dark by design rather than by preference — the feed and
 * the camera are full-bleed video, and a white chrome around a moving picture is wrong
 * in every app of this kind.
 */
export function FixedTheme({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  return <SchemeOverride.Provider value={scheme}>{children}</SchemeOverride.Provider>;
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const override = useContext(SchemeOverride);
  return themes[override ?? (system === "light" ? "light" : "dark")];
}

type Styles = Parameters<typeof StyleSheet.create>[0];

/**
 * Declares a screen's styles once, as a function of the theme, and returns a hook that
 * hands back the right sheet. Each scheme's sheet is built on first use and kept, so a
 * theme switch is a lookup rather than a rebuild.
 */
export function themedStyles<T extends Styles>(factory: (theme: Theme) => T) {
  const cache = new Map<Scheme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let sheet = cache.get(theme.scheme);
    if (!sheet) {
      sheet = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, sheet);
    }
    return sheet;
  };
}
