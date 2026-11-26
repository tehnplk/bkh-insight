import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/auth";
import { backupPath, recordDownload } from "@/lib/backup";

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}

// GET ?name=<ไฟล์> ; ชื่อต้องเป็นไฟล์สำรองที่มีอยู่จริงใน BACKUP_DIR (backupPath) กัน path traversal
export async function GET(request: Request) {
  const { error, name: by } = await adminSession();
  if (error) return error;
  const file = await backupPath(new URL(request.url).searchParams.get("name") ?? "");
  if (!file) return Response.json({ error: "ไม่พบไฟล์สำรอง" }, { status: 404 });
  const { size } = await stat(file);
  // บันทึกตอนเริ่มส่งไฟล์ ; เวลาไทยรูปแบบเดียวกับ `date -Iseconds` ของสคริปต์
  await recordDownload(file, by, `${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
      "Cache-Control": "no-store",
    },
  });
}
