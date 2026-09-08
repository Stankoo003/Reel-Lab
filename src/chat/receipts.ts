// Which tick a message of yours has earned.
//
// The server keeps two watermarks per participant — how far they have received, how far
// they have read — and a message's status is a comparison against them. Done here rather
// than as a field on each message so a receipt is one small frame however long the thread.
import type { Receipt } from "../../api/client";

export type MessageStatus = "sent" | "delivered" | "seen";

/**
 * The status of a message sent at `createdAt`, given the other side's receipt.
 *
 * Compared as milliseconds, not as strings: the server writes instants with more decimals
 * than JavaScript parses, and two ISO strings of different precision do not sort as their
 * moments do.
 */
export function statusOf(createdAt: string | undefined, receipt: Receipt | null): MessageStatus {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(at) || !receipt) return "sent";
  if (receipt.readAt && Date.parse(String(receipt.readAt)) >= at) return "seen";
  if (receipt.deliveredAt && Date.parse(String(receipt.deliveredAt)) >= at) return "delivered";
  return "sent";
}

/**
 * Merge a receipt that just arrived into the one held.
 *
 * Never backwards. A frame can arrive after a fresh page that already included it, and a
 * tick that flickers from seen back to delivered reads as the message being unread.
 */
export function mergeReceipt(prev: Receipt | null, next: Receipt | null | undefined): Receipt | null {
  if (!next) return prev;
  if (!prev) return next;
  return {
    ...next,
    deliveredAt: later(prev.deliveredAt, next.deliveredAt),
    readAt: later(prev.readAt, next.readAt),
  };
}

function later(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(String(b)) >= Date.parse(String(a)) ? b : a;
}
