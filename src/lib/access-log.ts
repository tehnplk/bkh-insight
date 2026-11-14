import { insightExecute } from "@/lib/db";

/** ผู้ใช้ที่ทำ request (จาก session ใน proxy) */
export type AccessUser = { name?: string | null; userId?: string | null; role?: string | null };

/**
 * บันทึกการเรียก /api/* หนึ่งครั้งลง access_log (PDPA: ใครดู/ส่งออก/นำเข้าอะไร เมื่อไร) เรียกจาก src/proxy.ts ผ่าน event.waitUntil
 * บันทึกไม่สำเร็จต้องไม่ทำให้ request ล้ม จึงกลืน error แล้ว log ไว้ที่ console
 */
export async function logAccess(user: AccessUser, method: string, path: string, query: string): Promise<void> {
  try {
    await insightExecute("INSERT INTO access_log (user_name, user_id, role, method, path, query) VALUES ($1, $2, $3, $4, $5, $6)", [
      user.name ?? null,
      user.userId ?? null,
      user.role ?? null,
      method,
      path.slice(0, 500),
      query ? query.slice(0, 2000) : null,
    ]);
  } catch (e) {
    console.error("access-log", (e as Error).message);
  }
}
