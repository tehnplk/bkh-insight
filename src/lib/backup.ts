import "server-only";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBackupName, type BackupFile, type BackupMeta, type BackupRun, type BackupVerify } from "./backup-status";

/** ค่าเดียวกับค่าเริ่มต้นใน scripts/backup-db.sh */
export const backupDir = () => process.env.BACKUP_DIR || "/var/backups/bkh-insight";

export type BackupState = { dir: string; configured: boolean; files: BackupFile[]; status: BackupRun | null; verify: BackupVerify | null };

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** ไฟล์สำรองใน BACKUP_DIR (ใหม่ก่อน) + sidecar + status.json + verify.json ; ไม่มีโฟลเดอร์ (เครื่อง dev) = configured false */
export async function loadBackups(): Promise<BackupState> {
  const dir = backupDir();
  const names = await readdir(dir).catch(() => null);
  if (!names) return { dir, configured: false, files: [], status: null, verify: null };
  const files = await Promise.all(
    names.flatMap((name) => {
      const parsed = parseBackupName(name);
      return parsed ? [readJson<BackupMeta>(path.join(dir, `${name}.json`)).then((meta) => ({ name, ...parsed, meta }))] : [];
    }),
  );
  files.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [status, verify] = await Promise.all([readJson<BackupRun>(path.join(dir, "status.json")), readJson<BackupVerify>(path.join(dir, "verify.json"))]);
  return { dir, configured: true, files, status, verify };
}

/** path ของไฟล์ที่มีอยู่จริงใน BACKUP_DIR เท่านั้น (ชื่อต้องตรงรูปแบบและอยู่ในรายการ readdir) ไม่งั้น null */
export async function backupPath(name: string): Promise<string | null> {
  if (!parseBackupName(name)) return null;
  const names = await readdir(backupDir()).catch(() => [] as string[]);
  return names.includes(name) ? path.join(backupDir(), name) : null;
}

/** ต่อท้าย downloads ใน sidecar (เขียนไฟล์ชั่วคราวแล้ว rename) ; ไม่มี sidecar สร้างใหม่จากชื่อไฟล์ */
// shortcut: อ่าน-แก้-เขียนไม่ล็อก ดาวน์โหลดพร้อมกันวินาทีเดียวกันอาจหายหนึ่งรายการ ใช้ flock เมื่อมีผู้ดาวน์โหลดหลายคนพร้อมกันจริง
export async function recordDownload(file: string, by: string, at: string) {
  const sidecar = `${file}.json`;
  const parsed = parseBackupName(path.basename(file))!;
  const meta = (await readJson<BackupMeta>(sidecar)) ?? { kind: parsed.kind, started_at: parsed.created_at, finished_at: parsed.created_at, size: 0, sha256: "", ok: true, downloads: [] };
  meta.downloads = [...(meta.downloads ?? []), { by, at }];
  await writeFile(`${sidecar}.tmp`, JSON.stringify(meta), { mode: 0o600 });
  await rename(`${sidecar}.tmp`, sidecar);
}
