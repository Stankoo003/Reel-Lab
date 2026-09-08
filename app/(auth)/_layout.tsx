import { Stack } from "expo-router";
import { FixedTheme } from "../../src/theme";

/**
 * The sign-in flow, and getting back in when the password is gone.
 *
 * Pinned dark: design 2b is drawn dark-only, and these two screens are one continuous
 * proposition rather than app chrome that should follow the device.
 *
 * Email and password rather than the design's phone-and-SMS-code: an SMS code needs a
 * sender the project does not have, and credentials are the form the backend will grow
 * first. The screens keep the design's shape — mark, large title, filled fields, accent
 * action — and swap what is asked for.
 *
 * These screens are the only way in. The root layout redirects here whenever there is no
 * valid session, and leaves on its own once there is one — so neither screen navigates
 * after a successful submit; doing both would race the gate.
 */
export default function AuthLayout() {
  return (
    <FixedTheme scheme="dark">
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="forgot-password" />
        {/*
          Also the target of the deep link reellab://reset-password?token=… , which the web
          fallback page hands over when the app turns out to be installed. The root gate
          leaves this route alone in both directions — see app/_layout.tsx.
        */}
        <Stack.Screen name="reset-password" />
      </Stack>
    </FixedTheme>
  );
}
