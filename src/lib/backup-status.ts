// Pure: ชนิดข้อมูลของไฟล์สำรองฐาน insight และกติกาแจ้งเตือน admin (test: backup-status.test.mjs)
// ไฟล์สถานะเขียนโดย scripts/backup-db.sh และ scripts/backup-verify.sh ไม่เก็บในฐาน เพื่อดูได้แม้ฐานล่ม

export type BackupKind = "nightly" | "manual" | "premigrate";
export type BackupDownload = { by: string; at: string };
/** sidecar `<ไฟล์>.json` */
export type BackupMeta = { kind: BackupKind; started_at: string; finished_at: string; size: number; sha256: string; ok: boolean; downloads: BackupDownload[] };
export type BackupFile = { name: string; kind: BackupKind; created_at: string; meta: BackupMeta | null };
/** status.json ของรอบล่าสุด (รวมรอบที่ล้มเหลว) */
export type BackupRun = { kind: BackupKind; started_at: string; finished_at: string; ok: boolean; file?: string; error?: string };
/** verify.json: mode restore = กู้ลงฐานชั่วคราวจริง, list = ตรวจโครง archive อย่างเดียว */
export type BackupVerify = {
  started_at: string;
  finished_at: string;
  file?: string;
  ok: boolean;
  mode?: "restore" | "list";
  sha256_ok?: boolean;
  tables?: Record<string, { restored: number | null; live: number | null }>;
  error?: string;
};
export type BackupAlert = { level: "notice" | "danger"; reason: string };

// เวลาเป็นเวลาไทยจาก `date` ใน server จึงตั้ง TZ ในสคริปต์ ; รูปแบบนี้เท่านั้นที่ดาวน์โหลดได้ (กัน path traversal)
const NAME = /^bkh-insight-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(nightly|manual|premigrate)\.dump\.gpg$/;

/** แยกชื่อไฟล์สำรอง ; ไม่ตรงรูปแบบคืน null */
export function parseBackupName(name: string): { kind: BackupKind; created_at: string } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, kind] = m;
  return { kind: kind as BackupKind, created_at: `${y}-${mo}-${d}T${h}:${mi}:${s}+07:00` };
}

const HOUR = 3_600_000;
export const STALE_BACKUP_HOURS = 26;
export const STALE_DOWNLOAD_DAYS = 3;
const time = (f: BackupFile) => Date.parse(f.meta?.finished_at ?? f.created_at);

/**
 * จุดแจ้งเตือนของลิงก์ "สำรองข้อมูล" ในเมนูโปรไฟล์ admin ; `files` = ไฟล์ที่มีอยู่จริง (สำเร็จแล้วเท่านั้น)
 * danger: รอบล่าสุดล้มเหลว / ไม่มีสำรองสำเร็จเกิน 26 ชม. / ไม่มีใครดาวน์โหลดเกิน 3 วัน
 * (นับจากการดาวน์โหลดล่าสุด ไม่เคยดาวน์โหลดนับจากไฟล์เก่าสุดที่ยังอยู่) ; notice: ไฟล์ล่าสุดยังไม่มีใครดาวน์โหลด
 */
export function backupAlert(status: BackupRun | null, files: BackupFile[], now: number): BackupAlert | null {
  if (status && !status.ok) return { level: "danger", reason: "สำรองข้อมูลรอบล่าสุดไม่สำเร็จ" };
  if (!files.length) return { level: "danger", reason: "ยังไม่มีไฟล์สำรองข้อมูล" };
  const sorted = [...files].sort((a, b) => time(a) - time(b));
  const latest = sorted.at(-1)!;
  if (now - time(latest) > STALE_BACKUP_HOURS * HOUR) return { level: "danger", reason: `ไม่มีการสำรองข้อมูลสำเร็จเกิน ${STALE_BACKUP_HOURS} ชั่วโมง` };
  const downloads = files.flatMap((f) => f.meta?.downloads ?? []).map((d) => Date.parse(d.at));
  const since = downloads.length ? Math.max(...downloads) : time(sorted[0]);
  if (now - since > STALE_DOWNLOAD_DAYS * 24 * HOUR) return { level: "danger", reason: `ไม่มีการดาวน์โหลดไฟล์สำรองเกิน ${STALE_DOWNLOAD_DAYS} วัน` };
  if (!latest.meta?.downloads.length) return { level: "notice", reason: "มีไฟล์สำรองใหม่ที่ยังไม่มีใครดาวน์โหลด" };
  return null;
}
