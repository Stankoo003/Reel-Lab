// The live half of messaging.
//
// Polling, since the backend moved to Next.js on a serverless host: there is no process to hold
// a WebSocket open, so a thread that is on screen asks the server every few seconds what has
// arrived — messages and the other side's receipt in one round trip (see
// fetchConversationUpdates). Sends still go over HTTP through the outbox; this module only
// carries what OTHER people did.
//
// The public surface is the one the STOMP version had, so the thread, inbox and settings
// screens did not have to change: connect / disconnect / reconnectNow, a connection state a
// screen can subscribe to, watchConversation for a thread, and a small trail for diagnosis.
//
// "connected" here means "the last poll (or the sign-in ping) succeeded". That is what a banner
// wants to know: whether what is on screen is current, and whether a queued send will go.
import { AppState, type AppStateStatus } from "react-native";
import { API_BASE_URL } from "../../api/config";
import { fetchConversationUpdates, fetchMe } from "../../api/client";
import { getToken, subscribe as subscribeToSession } from "../session";
import type { DirectMessage, Receipt } from "../../api/client";

/** How often an open thread asks for news. Slow enough to be kind to a free tier. */
const POLL_MS = 3000;
/** After a failure: back off, but not so far that walking back into wifi feels ignored. */
const RETRY_MS = 5000;

export type ConnectionState = "connecting" | "connected" | "offline";

/**
 * What arrives for a conversation: a message, or a receipt saying how far the other side has
 * received and read. Same shape the STOMP topic delivered.
 */
export type ThreadEvent =
  | { kind: "message"; message: DirectMessage }
  | { kind: "receipt"; receipt: Receipt };

type MessageListener = (event: ThreadEvent) => void;
type ErrorListener = (error: { conversationId: string; clientId: string; message: string }) => void;

type Room = {
  listeners: Set<MessageListener>;
  /** createdAt of the newest message seen; the next poll asks for what came after it. */
  after: string | null;
  /** The last receipt handed out, so an unchanged one is not delivered again. */
  receiptKey: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
};

let state: ConnectionState = "offline";
let lastError: string | null = null;
/** Generation counter: a disconnect invalidates every poll that was started before it. */
let generation = 0;
let appActive = AppState.currentState !== "background";

const trail: string[] = [];

function note(what: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${what}`;
  trail.unshift(line);
  trail.length = Math.min(trail.length, 8);
  // eslint-disable-next-line no-console
  console.log("[live]", what);
}

/** The recent history, for the Settings screen. */
export function socketTrail(): string[] {
  return [...trail];
}

const stateListeners = new Set<(next: ConnectionState) => void>();
const rooms = new Map<string, Room>();
const errorListeners = new Set<ErrorListener>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  for (const listener of stateListeners) listener(next);
}

export function connectionState(): ConnectionState {
  return state;
}

/** The reason the connection is not up, or null. Shown on the Settings screen. */
export function lastSocketError(): string | null {
  return lastError;
}

/** What it polls — the other half of diagnosing a connection that will not come up. */
export function socketEndpoint(): string {
  return `${API_BASE_URL.replace(/\/$/, "")}/api/conversations/{id}/updates (polling every ${POLL_MS / 1000}s)`;
}

export function onConnectionState(listener: (next: ConnectionState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onSocketError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function describe(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^[^:]+ failed: /, "");
}

/**
 * Come up: prove the token still works with one cheap authenticated call, then start polling
 * whatever is being watched. Signing in calls this; so does the retry banner.
 */
export function connect() {
  const token = getToken();
  if (!token) {
    note("connect skipped — no token yet");
    return;
  }
  const mine = ++generation;
  lastError = null;
  setState("connecting");
  note(`pinging ${API_BASE_URL} (token …${token.slice(-6)})`);
  fetchMe().then(
    () => {
      if (mine !== generation) return;
      note("CONNECTED");
      setState("connected");
      for (const [conversationId, room] of rooms) schedule(conversationId, room, 0);
    },
    (e) => {
      if (mine !== generation) return;
      lastError = describe(e);
      note(`ping failed: ${lastError}`);
      setState("offline");
      // Keep trying on the retry cadence, like the socket's own reconnect loop did.
      setTimeout(() => {
        if (mine === generation && getToken()) connect();
      }, RETRY_MS);
    }
  );
}

/** Try again now, rather than waiting out the retry delay. */
export function reconnectNow() {
  connect();
}

export function disconnect() {
  generation++;
  lastError = null;
  for (const room of rooms.values()) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.inFlight = false;
  }
  setState("offline");
}

function schedule(conversationId: string, room: Room, delay: number) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = null;
    void poll(conversationId, room);
  }, delay);
}

async function poll(conversationId: string, room: Room) {
  if (!rooms.has(conversationId) || room.inFlight) return;
  if (!getToken()) return;
  if (!appActive) {
    // Backgrounded: nothing is looking. The next foreground restarts every room.
    return;
  }
  const mine = generation;
  room.inFlight = true;
  try {
    const updates = await fetchConversationUpdates(conversationId, room.after);
    if (mine !== generation || !rooms.has(conversationId)) return;
    for (const message of updates.messages) {
      if (message.createdAt && (!room.after || Date.parse(String(message.createdAt)) >= Date.parse(room.after))) {
        room.after = String(message.createdAt);
      }
      for (const listener of room.listeners) listener({ kind: "message", message });
    }
    const key = updates.otherReceipt ? JSON.stringify(updates.otherReceipt) : null;
    if (key && key !== room.receiptKey) {
      room.receiptKey = key;
      for (const listener of room.listeners) listener({ kind: "receipt", receipt: updates.otherReceipt! });
    }
    if (state !== "connected") {
      lastError = null;
      note("poll ok — CONNECTED");
      setState("connected");
    }
    schedule(conversationId, room, POLL_MS);
  } catch (e) {
    if (mine !== generation) return;
    lastError = describe(e);
    if (state === "connected") note(`poll failed: ${lastError}`);
    setState("offline");
    schedule(conversationId, room, RETRY_MS);
  } finally {
    room.inFlight = false;
  }
}

/**
 * Watch one conversation. Returns the unsubscribe.
 *
 * Polling starts from "now": the thread loads its own history, and reconciles anything that
 * slipped between that load and the first poll with fetchMessagesSince when it sees
 * "connected" — the same two-step the socket version relied on.
 */
export function watchConversation(conversationId: string, listener: MessageListener): () => void {
  let room = rooms.get(conversationId);
  if (!room) {
    room = { listeners: new Set(), after: new Date().toISOString(), receiptKey: null, timer: null, inFlight: false };
    rooms.set(conversationId, room);
    if (getToken()) schedule(conversationId, room, 0);
  }
  room.listeners.add(listener);

  return () => {
    const current = rooms.get(conversationId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      if (current.timer) clearTimeout(current.timer);
      rooms.delete(conversationId);
    }
  };
}

/** Kept for API compatibility: a refused send now surfaces as the HTTP error the outbox sees. */
export function watchErrors() {}

// Foreground resumes every room's polling at once; background lets the timers lapse.
AppState.addEventListener("change", (next: AppStateStatus) => {
  const active = next === "active";
  if (active === appActive) return;
  appActive = active;
  if (active && getToken()) {
    note("foreground — resuming");
    for (const [conversationId, room] of rooms) schedule(conversationId, room, 0);
  }
});

/**
 * The session decides whether there is a connection at all. Signing in opens one; signing out
 * closes it, which also stops the old account's rooms from being polled under the new one.
 */
subscribeToSession(() => {
  if (getToken()) {
    connect();
  } else {
    disconnect();
  }
});
