import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";

export type AdminUser = {
  id: string; // bigint comes back as a string
  provider_id: string;
  pname: string | null;
  fname: string;
  lname: string;
  role: string;
  is_approve: boolean;
  job_position: string | null;
  organizations: Organization[]; // set at sign-in from the SSO profile (src/auth.ts)
};
export type Organization = { org_code: string | null; org_name: string | null; job_position: string | null };

// Sort keys from DataGrid are column names; anything else is rejected by parseGridQuery. Never organizations.
const SORTABLE = ["id", "provider_id", "fname", "lname", "role", "is_approve", "job_position"] as const;

// Shared by the list and count queries so they cannot drift apart. $1 = search (null or a LIKE pattern).
const WHERE = `WHERE ($1::text IS NULL OR fname ILIKE $1 OR lname ILIKE $1 OR provider_id ILIKE $1
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(organizations) x WHERE x->>'org_name' ILIKE $1))`;

// proxy.ts covers a missing session too, but admin routes check both themselves.
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin", userId: session.user.userId };
}

export async function GET(request: NextRequest) {
  const { error } = await adminSession();
  if (error) return error;

  const parsed = parseGridQuery(request.nextUrl.searchParams, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  const like = q ? `%${escapeLike(q)}%` : null;
  // sort is from the allowlist, so it is safe as an identifier.
  const select = `SELECT id, provider_id, pname, fname, lname, role, is_approve, job_position, organizations
FROM users
${WHERE}
ORDER BY ${sort ?? "id"} ${dir === "desc" ? "DESC" : "ASC"}, id`;

  if (format === "xlsx") {
    const rows = (await insightQuery<AdminUser>(select, [like])).map((r, i) => ({
      ...r,
      no: i + 1,
      org_names: r.organizations.map((o) => o.org_name).filter(Boolean).join(", "),
    }));
    return xlsxResponse<(typeof rows)[number]>("users.xlsx", [
      { key: "no", header: "ลำดับ", width: 8 },
      { key: "id", header: "id", width: 8 },
      { key: "provider_id", header: "Provider ID", width: 38 },
      { key: "pname", header: "คำนำหน้า", width: 12 },
      { key: "fname", header: "ชื่อ", width: 20 },
      { key: "lname", header: "นามสกุล", width: 20 },
      { key: "job_position", header: "ตำแหน่ง", width: 28 },
      { key: "org_names", header: "หน่วยบริการ", width: 36 },
      { key: "role", header: "role", width: 10 },
      { key: "is_approve", header: "อนุมัติ", width: 10 },
    ], rows);
  }

  const [rows, [{ total }]] = await Promise.all([
    insightQuery<AdminUser>(`${select}
LIMIT $2 OFFSET $3`, [like, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total
FROM users
${WHERE}`, [like]),
  ]);
  const body: GridPage<AdminUser> = { rows, total };
  return Response.json(body);
}

const ID = /^[1-9]\d{0,17}$/; // positive, fits bigint
const ROLES = ["user", "admin"]; // same as the users_role_check constraint

// One change per request, logged with the admin's name from the session (never from the body):
//   { id: "12", approve: true | false }  or  { id: "12", role: "user" | "admin" }
// A role change takes effect at that user's next sign-in (the role lives in their JWT).
export async function POST(request: Request) {
  const { error, name, userId } = await adminSession();
  if (error) return error;

  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !ID.test(id)) return Response.json({ error: "id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });
  if (("approve" in body) === ("role" in body)) {
    return Response.json({ error: "ส่ง approve หรือ role อย่างใดอย่างหนึ่ง" }, { status: 400 });
  }

  if ("role" in body) {
    const role = body.role;
    if (!ROLES.includes(role)) return Response.json({ error: "role ต้องเป็น user หรือ admin" }, { status: 400 });
    // The super user has no users row (userId undefined), so this never blocks them.
    if (userId === id) return Response.json({ error: "เปลี่ยน role ของตัวเองไม่ได้" }, { status: 400 });
    const [row] = await insightQuery<{ id: string; role: string }>(
      `UPDATE users
SET role = $2::text,
    log = log || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'set_role', 'role', $2::text, 'by', $3::text))
WHERE id = $1
RETURNING id, role`,
      [id, role, name],
    );
    if (!row) return Response.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
    return Response.json(row);
  }

  const approve = body.approve;
  if (typeof approve !== "boolean") return Response.json({ error: "approve ต้องเป็น true หรือ false" }, { status: 400 });

  const [row] = await insightQuery<{ id: string; is_approve: boolean }>(
    `UPDATE users
SET is_approve = $2,
    log = log || jsonb_build_array(jsonb_build_object(
      'at', now(),
      'action', CASE WHEN $2 THEN 'approve' ELSE 'unapprove' END,
      'by', $3::text))
WHERE id = $1
RETURNING id, is_approve`,
    [id, approve, name],
  );
  if (!row) return Response.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
  return Response.json(row);
}
