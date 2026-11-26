import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { auth } from "@/auth";
import { loadBackups, type BackupState } from "@/lib/backup";
import { backupAlert, type BackupAlert } from "@/lib/backup-status";

/** alert = เหตุผลเดียวกับจุดแจ้งเตือนในเมนูโปรไฟล์ (null เมื่อไม่ได้ตั้งค่าหรือไม่มีอะไรต้องเตือน) */
export type BackupData = BackupState & { alert: BackupAlert | null };

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  const b = await loadBackups();
  return Response.json({ ...b, alert: b.configured ? backupAlert(b.status, b.files, Date.now()) : null } satisfies BackupData);
}

// path คงที่ ไม่มีค่าจากผู้ใช้ ; สคริปต์อ่าน .env เอง (รหัสผ่านไม่ผ่าน argv) และกันรันซ้อนด้วย flock (exit 75)
const SCRIPT = path.join(process.cwd(), "scripts", "backup-db.sh");
const run = promisify(execFile);

export async function POST() {
  const { error } = await adminSession();
  if (error) return error;
  if (!(await loadBackups()).configured) return Response.json({ error: "ไม่พบโฟลเดอร์เก็บไฟล์สำรองบนเครื่องนี้" }, { status: 409 });
  try {
    await run("bash", [SCRIPT, "manual"], { timeout: 30 * 60_000 });
    return Response.json({ ok: true });
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    const message = err.stderr?.trim().split("\n").at(-1) || "สำรองข้อมูลไม่สำเร็จ";
    return Response.json({ error: message }, { status: err.code === 75 ? 409 : 500 });
  }
}
