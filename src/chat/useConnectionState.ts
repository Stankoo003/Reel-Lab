// The socket's state, for a screen that wants to say so.
import { useSyncExternalStore } from "react";
import { connectionState, onConnectionState } from "./socket";

/**
 * Read-only. The socket connects and reconnects on its own — a screen's job is to reflect
 * that, never to drive it, or two screens would fight over one connection.
 */
export function useConnectionState() {
  return useSyncExternalStore(onConnectionState, connectionState, connectionState);
}
