import { json, query, route } from "@/lib/handler";
import { userSummary } from "@/services/dto";
import { search } from "@/services/users";

export const GET = route(async (req) => {
  const params = query(req);
  const limit = params.get("limit");
  const rows = await search(params.get("q"), limit ? Number(limit) : null);
  return json(rows.map(userSummary));
});
