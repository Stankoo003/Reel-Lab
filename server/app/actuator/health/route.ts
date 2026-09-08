import { sql } from "@/db/client";
import { json } from "@/lib/handler";

export const dynamic = "force-dynamic";

/** The shape Spring's actuator produced; the Settings screen renders status and components.db. */
export async function GET() {
  let db = "UP";
  try {
    await sql`select 1`;
  } catch {
    db = "DOWN";
  }
  const status = db === "UP" ? "UP" : "DOWN";
  return json({ status, components: { db: { status: db }, diskSpace: { status: "UP" }, ping: { status: "UP" } } },
    { status: status === "UP" ? 200 : 503 });
}
