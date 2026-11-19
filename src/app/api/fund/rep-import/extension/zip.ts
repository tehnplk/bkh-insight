import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

// next start รันจากโฟลเดอร์ repo (ไม่ใช้ output standalone) โฟลเดอร์ extension จึงอยู่ข้างแอปหลัง git pull
const EXTENSION_DIR = path.join(process.cwd(), "extension/eclaim-sync");

/** ไฟล์ที่ Chrome ใช้: ไม่รวม test และ package.json (มีไว้ให้ Node อ่าน .js เป็น module เท่านั้น) */
export const shipped = (rel: string) => rel !== "package.json" && !rel.endsWith(".test.js");

/** zip ของ extension/eclaim-sync (ไม่มีโฟลเดอร์ครอบ แตกแล้ว manifest.json อยู่บนสุด) และเวอร์ชันจาก manifest.json */
export async function extensionZip(dir = EXTENSION_DIR) {
  const zip = new JSZip();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = path.join(e.parentPath, e.name);
    const rel = path.relative(dir, file).replaceAll("\\", "/");
    if (shipped(rel)) zip.file(rel, await readFile(file));
  }
  const { version } = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as { version: string };
  return { version, data: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }) };
}
