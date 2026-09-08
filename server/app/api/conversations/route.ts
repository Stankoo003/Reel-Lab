import { requireUser } from "@/lib/auth";
import { body, json, route } from "@/lib/handler";
import { OpenConversationRequest } from "@/lib/schemas";
import { listFor, openWith } from "@/services/conversations";
import { conversationResponse, summarise } from "@/services/messages";

export const GET = route(async (req) => {
  const { userId } = await requireUser(req);
  const threads = await listFor(userId);
  const summary = await summarise(threads.map((t) => t.id), userId);
  return json(await Promise.all(threads.map((t) => conversationResponse(t, userId, summary))));
});

/** Start or find the thread with one person. Refused if either has blocked the other. */
export const POST = route(async (req) => {
  const { userId } = await requireUser(req);
  const request = await body(req, OpenConversationRequest);
  const thread = await openWith(userId, request.userId);
  return json(await conversationResponse(thread, userId, await summarise([thread.id], userId)));
});
