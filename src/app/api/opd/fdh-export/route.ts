import type { NextRequest } from "next/server";
import JSZip from "jszip";
import { hisQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { FILE_ORDER } from "@/app/api/fdh/c-check/files";
import { ecHealthMedSql, exportSql, fileColumns, type FileRow } from "@/app/api/fdh/files/sql";
import { toTxt } from "@/app/api/fdh/files/txt";
import { fillLabTmlt } from "@/app/api/fdh/files/lab-tmlt";
import type { FdhPreview } from "@/components/fdh-preview/fdh-preview";
import { keepSelected, parseOpdSelection } from "../fdh-files";

/**
 * POST { vns: string[], format?: "json" | "eclaim-hm" } → 16 แฟ้มผู้ป่วยนอกของ visit ที่เลือก (json ไว้ดูบนหน้าจอ หรือ zip ของ .txt)
 * "eclaim-hm" = { rows } แถว OOP แพทย์แผนไทยของ e-Claim (ecHealthMedSql) ที่ปุ่มส่งออก e-Claim ขอเพิ่มตอนกด
 * ใช้ SQL 16 แฟ้มชุดเดิมที่พิสูจน์แล้ว (ช่วงวันที่ครอบ visit ที่เลือก) แล้วกรองแถวตาม SEQ/HN ; รันทีละแฟ้มเพราะหลายแฟ้มอ่าน opitemrece
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { vns?: unknown; format?: unknown } | null;
  let sel;
  try {
    sel = await parseOpdSelection(body);
  } catch (e) {
    console.error("opd/fdh-export selection", e);
    return Response.json({ error: `อ่าน visit ที่เลือกไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
  if ("error" in sel) return badRequest(sel.error);

  if (body?.format === "eclaim-hm") {
    try {
      return Response.json({ rows: await hisQuery<FileRow>(ecHealthMedSql(sel.vns.length), sel.vns) });
    } catch (e) {
      console.error("opd/fdh-export eclaim-hm", e);
      return Response.json({ error: `อ่านบริการแพทย์แผนไทยไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
    }
  }

  const files: FdhPreview["files"] = [];
  try {
    for (const file of FILE_ORDER.op) {
      const rows = await fillLabTmlt(file, (await hisQuery<FileRow>(exportSql("op", file), [sel.start, sel.end])).filter(keepSelected(file, sel)));
      files.push({ file, columns: fileColumns("op", file), rows });
    }
  } catch (e) {
    console.error("opd/fdh-export", e);
    return Response.json({ error: `อ่านข้อมูล 16 แฟ้มไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
  if (body?.format === "json") return Response.json({ files } satisfies FdhPreview);

  const zip = new JSZip();
  for (const f of files) zip.file(`${f.file}.txt`, toTxt(f.columns, f.rows));
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(data as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="fdh-op-${todayIso()}-${sel.vns.length}.zip"` },
  });
}
