import { useEffect } from "react";
import { View } from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/state/AuthContext";
// Imported for its effect: the module subscribes to the session and opens or closes the one
// socket the app has. Importing it here means that happens once, at startup, rather than
// whenever a chat screen happens to mount.
import "../src/chat/socket";
import { ClipsProvider } from "../src/state/ClipsContext";
import { PLAYBACK_MODE } from "../src/audioSession";
import { useTheme } from "../src/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Outside ClipsProvider: clips belong to whoever is signed in, so signing out has to
          be able to tear them down rather than hand them to the next account. */}
      <AuthProvider>
        <ClipsProvider>
          <RootNavigator />
        </ClipsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { c } = useTheme();
  const { status } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    /*
      The feed's audio policy. Set once, globally, because an audio session is a
      process-wide thing — a per-screen setting would be fighting itself.

      playsInSilentMode: true
        iOS — the feed plays audio with the hardware Ring/Silent switch flipped to
        silent. This is deliberate, and it is the behaviour of every short-video feed:
        a viewer who opened a video expects sound, and silence there reads as a broken
        app rather than as a respected device setting. The escape hatch is the mute
        button on the clip, which is why this feature ships with one. Volume still
        applies, so a viewer who wants silence is never without a way to get it.
        Android — the flag is a no-op. Android has no ring/silent switch governing
        media; media volume does, and the system already honours it.

      shouldPlayInBackground: false
        Both platforms — audio stops when the app leaves the foreground. A feed has no
        business playing to a locked screen, and expo-video's config plugin has
        supportsBackgroundPlayback: false in app.json to match; the two must agree.

      interruptionMode: "doNotMix"
        Both platforms — the feed asks for exclusive audio focus, so starting it pauses
        music from another app rather than playing over it. On iOS the OS then hands
        back an interruption when a call arrives; on Android this is a
        AUDIOFOCUS_GAIN request. Either way playback stops and the pool re-asserts it
        when the app comes back — see useVideoPool.
    */
    setAudioModeAsync({ ...PLAYBACK_MODE }).catch(() => {
      // Non-fatal: playback still works. It just falls back to the platform default,
      // which on iOS means the silent switch wins.
    });
  }, []);

  // Nothing but the background until the keychain has been read. Rendering the tabs first
  // and redirecting a moment later would flash the signed-in app at someone who is not.
  if (status === "loading") {
    return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  }

  /*
    The gate runs both ways, and it has to: signing in sets the session but does not move
    anyone, so without the second redirect a user who just registered would be left sitting
    on the signup screen holding a valid token.

    Route groups are not part of the URL, so `app/(auth)/login.tsx` is `/login` here.
  */
  const inAuthGroup =
    pathname.startsWith("/login")
    || pathname.startsWith("/signup")
    || pathname.startsWith("/forgot-password")
    || pathname.startsWith("/reset-password");

  /*
    Reset is the one auth screen that both halves of the gate have to leave alone.

    Signed out, it must not be redirected to /login — a reset link carries its token in the
    URL, and bouncing to the sign-in screen throws that token away, which turns every emailed
    link into a dead one.

    Signed in, it must not be redirected to the feed either. Following a reset link while a
    session happens to be alive on this phone is exactly what someone does when they think
    that session is not theirs — and the reset is what ends it.
  */
  const isResetLink = pathname.startsWith("/reset-password");

  // Not while already inside the auth group — redirecting to where you are is a loop.
  if (status === "signedOut" && !inAuthGroup) {
    return <Redirect href="/(auth)/login" />;
  }

  // Signed in and still on a sign-in screen: the session just arrived. `/(tabs)` lands on
  // the feed, which is the first trigger in the tab bar.
  if (status === "signedIn" && inAuthGroup && !isResetLink) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.bg },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* The gate above redirects here whenever there is no valid session. */}
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="editor" />
          <Stack.Screen name="export" options={{ gestureEnabled: false }} />
          <Stack.Screen name="result" options={{ gestureEnabled: false }} />
          <Stack.Screen name="post" />
          {/*
            Pushed from a feed row or the profile grid, never reachable for a local clip.

            A transparent modal rather than a sheet of its own, because design 2a keeps the
            clip visible and playing behind the comments — the screen draws its own 62%
            panel and leaves the rest to show through, which a `modal` presentation (opaque,
            and on Android full-screen) cannot do.
          */}
          <Stack.Screen
            name="comments"
            options={{
              presentation: "transparentModal",
              animation: "slide_from_bottom",
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          {/* Another user's profile, read-only. Pushed from a feed row's @username. */}
          <Stack.Screen name="user" options={{ presentation: "modal" }} />
          {/* The profile's link as a scannable code. Pushed from the profile's Share action. */}
          <Stack.Screen name="share" options={{ presentation: "modal" }} />
          {/* A clip into a conversation. Pushed from the feed's SHARE control. */}
          <Stack.Screen name="share-video" options={{ presentation: "modal" }} />
          {/* Account, health and environment. Pushed from the profile's Settings action. */}
          <Stack.Screen name="settings" options={{ presentation: "modal" }} />
          {/*
            One conversation. The LIST is a tab — app/(tabs)/inbox.tsx — but a thread is
            pushed, from the inbox or straight from a profile's Message button.
          */}
          <Stack.Screen name="thread" />
        </Stack>
      <StatusBar style="auto" />
    </>
  );
}
