import { Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { font, useTheme } from "../../src/theme";

/**
 * The system's own tab bar, not one drawn in JS: Liquid Glass on iOS 26, a Material 3
 * BottomNavigationView on Android. That is what lets the feed run edge to edge — on both
 * platforms the screen content sits *behind* this bar rather than being shrunk above it.
 *
 * Colours are pinned rather than inherited. app.json sets userInterfaceStyle "automatic",
 * so the Android bar would otherwise take dynamic Material colours and render light on a
 * light-mode phone, against a fixed-dark app.
 */
export default function TabsLayout() {
  const { c } = useTheme();

  return (
    <NativeTabs
      tintColor={c.accent}
      // Unselected is white on the dark bar (the token turns to ordinary ink in the light
      // scheme, where white would vanish into the glass). The label takes the same colour:
      // a white icon over a half-tint label reads as a rendering fault, not a hierarchy.
      iconColor={{ default: c.tabIconIdle, selected: c.accent }}
      labelStyle={{ fontFamily: font.sans, fontSize: 10, color: c.tabIconIdle }}
      // iOS: no background, so the system supplies glass. Android: an alpha fill is what
      // lets the reel show through the bar. The fill follows the scheme; the feed behind
      // it does not, so it stays translucent in both.
      backgroundColor={Platform.select({ android: c.scrimSoft })}
      indicatorColor={c.accentBgStrong}
      rippleColor={c.accentBgStrong}
      minimizeBehavior="onScrollDown"
    >
      {/*
        Only the feed runs under the bar. Set here rather than from inside the screen —
        the in-screen form applies it through setOptions on focus, so the option lands after
        the first layout, whereas here it is part of the initial screen options.
      */}
      {/*
        Outline until selected, filled once it is — so the tab reads as chosen by shape as
        well as by colour. `md` has no outline/filled pair under one name, so Android is
        carried by the indicator and tint it already has.
      */}
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon
          sf={{ default: "play.square.stack", selected: "play.square.stack.fill" }}
          md="smart_display"
        />
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/*
        Second, not last: search belongs beside the thing it searches. The screen behind it
        is a placeholder — see app/(tabs)/search.tsx — but the slot is claimed now so the
        other tabs do not shift position once it is built.
      */}
      <NativeTabs.Trigger name="search">
        {/*
          Bare glass, no ring. SF has no filled variant of it, so unlike the other three this
          tab has no outline-to-filled change — the accent tint carries the selected state on
          its own, which is what the other tabs lean on anyway.
        */}
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/*
        The camera insets its controls above the floating tab bar, which exposes the screen's
        own background in the gap. That background is the root Stack's, and it follows the
        device scheme — so on a light-mode phone a white strip appeared under a black
        viewfinder. `bgCamera` is #000000 in both schemes, which is the point of the token.
      */}
      <NativeTabs.Trigger name="create" contentStyle={{ backgroundColor: c.bgCamera }}>
        <NativeTabs.Trigger.Icon
          sf={{ default: "plus.circle", selected: "plus.circle.fill" }}
          md="add_circle"
        />
        <NativeTabs.Trigger.Label>Create</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/*
        No "My videos" tab: the design folds the grid into the profile page as a segmented
        section (VIDEOS / LIKED / DRAFTS), so the library is one scroll away from the
        identity it belongs to rather than a peer of the feed.
      */}
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
          md="account_circle"
        />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
