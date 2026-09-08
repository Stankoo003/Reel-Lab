// Messages that have been written but not yet accepted by the server.
//
// This is what makes "kill the network mid-send" survivable. A message typed while offline is
// not lost and not silently dropped: it is written to disk, shown in the thread as pending,
// and retried until the server takes it.
//
// Persisted, not merely held in memory, because the interesting failure is not a flaky
// request — it is the app being killed while the phone has no signal. A queue that lives only
// in memory loses exactly the messages it exists to protect.
import { Directory, File, Paths } from "expo-file-system";
import { sendMessage } from "../../api/client";
import type { DirectMessage } from "../../api/client";

export type QueuedMessage = {
  /** Generated before the send, and echoed back by the server so the two can be matched. */
  clientId: string;
  conversationId: string;
  body: string;
  /** A clip being shared. The body is then allowed to be empty. */
  videoId?: string;
  /** When it was written — what the thread sorts a pending bubble by. */
  createdAt: string;
  /** How many times delivery has been attempted. */
  attempts: number;
  /** The server's reason, when it refused for good — a block, or a rate limit. */
  error?: string;
};

const MAX_ATTEMPTS = 8;

let queue: QueuedMessage[] = [];
let loaded = false;
let flushing = false;
const listeners = new Set<() => void>();

function file(): File {
  const dir = new Directory(Paths.document, "chat");
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, "outbox.json");
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const handle = file();
    if (!handle.exists) return;
    const raw: unknown = JSON.parse(handle.textSync());
    // Shaped rather than trusted: a half-written file from a crash mid-save would otherwise
    // put an object with no body into the thread.
    queue = Array.isArray(raw)
      ? raw.filter((x): x is QueuedMessage =>
          !!x && typeof x === "object"
          && typeof (x as QueuedMessage).clientId === "string"
          && typeof (x as QueuedMessage).body === "string")
      : [];
  } catch {
    queue = [];
  }
}

function save() {
  try {
    file().write(JSON.stringify(queue));
  } catch {
    // Losing the persistence is survivable — the in-memory copy still delivers this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeToOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What is still pending for one thread, oldest first — rendered under the delivered ones. */
export function pendingFor(conversationId: string): QueuedMessage[] {
  load();
  return queue
    .filter((item) => item.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Queue a message and try to send it now.
 *
 * Always queued first, even when the network looks fine: "looks fine" is a guess, and a send
 * that fails after an optimistic bubble was drawn has to have something to retry.
 */
export async function enqueue(
  conversationId: string,
  body: string,
  videoId?: string
): Promise<void> {
  load();
  const item: QueuedMessage = {
    clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    conversationId,
    body,
    videoId,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  queue.push(item);
  save();
  await flush();
}

/**
 * Try to deliver everything, oldest first.
 *
 * In order, and one at a time, because a thread where the second message arrives before the
 * first is worse than one that is briefly slow. A failure stops the run rather than skipping
 * ahead — the next flush picks up where this one stopped.
 */
export async function flush(): Promise<void> {
  load();
  if (flushing) return;
  flushing = true;
  try {
    // A copy: `queue` is mutated as items are delivered.
    for (const item of [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!queue.includes(item)) continue;
      try {
        await sendMessage(item.conversationId, item.body, item.clientId, item.videoId);
        remove(item.clientId);
      } catch (e) {
        item.attempts += 1;
        const message = e instanceof Error ? e.message : String(e);
        // A refusal is not a network failure, and retrying it forever would keep a bubble on
        // screen that will never be delivered. A block or a rate limit is the server's final
        // answer for this message; the user is told and can delete or retype it.
        const refused =
          /blocked|too quickly|not yours|at most|needs some text|cannot be shared/i.test(message);
        if (refused || item.attempts >= MAX_ATTEMPTS) {
          item.error = message;
        }
        save();
        // Stop on the first failure: if the network is down, the rest will fail too, and
        // hammering it is how a queue turns into a retry storm.
        if (!refused) break;
      }
    }
  } finally {
    flushing = false;
    save();
  }
}

/** Drop one, by the id the sender generated. */
export function remove(clientId: string) {
  load();
  const before = queue.length;
  queue = queue.filter((item) => item.clientId !== clientId);
  if (queue.length !== before) save();
}

/**
 * A message came back from the server — drop the pending copy if it is ours.
 *
 * This is what the clientId is for. Without it the sender sees their own message twice: once
 * as the optimistic bubble and once as the delivered one, with no way to tell they are the
 * same message.
 */
export function reconcile(message: DirectMessage) {
  if (message.clientId) remove(message.clientId);
}

/** Give a refused message another chance — after the user has been unblocked, or waited. */
export function retry(clientId: string) {
  load();
  const item = queue.find((x) => x.clientId === clientId);
  if (!item) return;
  item.attempts = 0;
  item.error = undefined;
  save();
  void flush();
}

/** Everything queued, across all threads — used to show one badge for "not sent". */
export function pendingCount(): number {
  load();
  return queue.length;
}
