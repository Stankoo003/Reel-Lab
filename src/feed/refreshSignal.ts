// "The feed is out of date" — set by whoever made it so, read by the feed.
//
// Publishing lands the user back on the feed, and the feed at that moment is holding the
// page it fetched before the clip existed. Reloading on every focus would be the easy fix
// and the wrong one: switching tabs would then throw away the reader's position and restart
// whatever was playing, which is a worse bug than the one it solves.
//
// So the reload is requested, not scheduled. Publishing sets the flag; the feed consumes it
// the next time it is focused and reloads only then.
//
// A module rather than context because the two ends are a route and a tab that never share
// a tree in a way React state could span, and because the flag outlives the screen that
// set it — post.tsx has already been dismissed by the time the feed reads this.

let pending = false;

/** Something published. The feed should reload when it next comes into view. */
export function requestFeedRefresh(): void {
  pending = true;
}

/** True at most once per request — reading it clears it, so one publish is one reload. */
export function consumeFeedRefresh(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}
