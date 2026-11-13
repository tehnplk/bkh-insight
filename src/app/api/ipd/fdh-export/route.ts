import type { NextRequest } from "next/server";
import JSZip from "jszip";
import { hisQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { FILE_ORDER } from "@/app/api/fdh/c-check/files";
import { fileColumns, ipAnExportSql, type FileRow } from "@/app/api/fdh/files/sql";
import { toTxt } from "@/app/api/fdh/files/txt";
import { MAX_EXPORT_ANS, type FdhPreview } from "../admissions/admissions";

/**
 * POST { ans: string[], format?: "json" } → zip ของ 16 แฟ้มผู้ป่วยใน (format "json" = คืนข้อมูลรายแฟ้มไว้ดูบนหน้าจอ ไม่สร้างไฟล์) (.txt รูปแบบเดียวกับหน้า 16 แฟ้มมาตรฐาน) เฉพาะ admission ที่เลือก
 * ใส่เฉพาะแฟ้มที่มีแถว (แบบโปรแกรมที่ส่ง FDH จริง) รันทีละแฟ้มไม่ขนาน เพราะ CHA/ADP/DRU/PHDB อ่าน opitemrece (MyISAM)
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { ans?: unknown; format?: unknown } | null;
  const ans = Array.isArray(body?.ans) ? [...new Set(body.ans)] : [];
  if (!ans.length || ans.length > MAX_EXPORT_ANS || !ans.every((a) => typeof a === "string" && /^\d{9}$/.test(a))) {
    return badRequest(`ans ต้องเป็น AN 9 หลัก 1–${MAX_EXPORT_ANS} รายการ`);
  }

  const today = todayIso();
  const files: FdhPreview["files"] = [];
  try {
    for (const file of FILE_ORDER.ip) {
      const rows = await hisQuery<FileRow>(ipAnExportSql(file, ans.length), [today, today, ...(ans as string[])]);
      files.push({ file, columns: fileColumns("ip", file), rows });
    }
  } catch (e) {
    console.error("ipd/fdh-export", e);
    return Response.json({ error: `อ่านข้อมูล 16 แฟ้มไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
  if (body?.format === "json") return Response.json({ files } satisfies FdhPreview);

  const zip = new JSZip();
  const counts: Record<string, number> = {};
  for (const f of files) {
    counts[f.file] = f.rows.length;
    if (f.rows.length) zip.file(`${f.file}.txt`, toTxt(f.columns, f.rows));
  }

  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(data as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fdh-ip-${today}-${ans.length}.zip"`,
      // จำนวนแถวต่อแฟ้ม ให้หน้าแสดงผลหลังดาวน์โหลด
      "X-Fdh-Counts": encodeURIComponent(JSON.stringify(counts)),
    },
  });
}
