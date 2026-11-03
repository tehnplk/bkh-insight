import { connection } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";

// Returns null on success, otherwise a safe message: the env-name error from db.ts or the MySQL
// error code. Never the raw driver message, which can contain host or user.
async function check(query: (sql: string) => Promise<unknown>): Promise<string | null> {
  try {
    await query("SELECT 1");
    return null;
  } catch (e) {
    const { message, code } = e as Error & { code?: string };
    return message.startsWith("Missing env:") ? message : (code ?? "connection failed");
  }
}

export async function GET() {
  await connection(); // run per request, not at build time
  const [his, insight] = await Promise.all([check((s) => hisQuery(s)), check((s) => insightQuery(s))]);
  return Response.json(
    {
      his: his ? "error" : "ok",
      insight: insight ? "error" : "ok",
      ...((his || insight) && { errors: { his, insight } }),
    },
    { status: his || insight ? 503 : 200 },
  );
}
