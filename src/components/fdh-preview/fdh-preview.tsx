"use client";

// modal 16 แฟ้ม (ดูข้อมูลรายแฟ้ม, ตรวจ C ทีละแฟ้มพร้อมแถบความคืบหน้า, กรองเฉพาะแถวที่ติด C, ส่งออก zip รูปแบบ FDH, e-Claim TEXT หรือ DBF (eclaim.ts, dbf.ts) และ Excel) ใช้ร่วม /ipd/admissions และ /opd/admissions
// ข้อมูลมาจาก endpoint ของหน้า (POST { [idField]: ids, format: "json" }) ตรวจ C ผ่าน checkUrl (POST { [idField]: ids, file })
// ยิงทีละชุดไม่เกิน chunkSize ราย เรียงกันไม่ขนาน (pool ของ his มี 3 connection ใช้ร่วมทุกผู้ใช้) แล้วรวมผลด้วย batch.ts
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { todayIso } from "@/lib/thai-date";
import { cLabel, codeLevel, type Level } from "@/app/api/fdh/c-check/files";
import { XLSX_MAX_BODY, XLSX_MAX_ROWS } from "@/app/api/fdh/files/txt";
import type { CheckFinding, CheckResult } from "@/app/api/ipd/fdh-check/check";
import { batchItems, type Channel } from "@/app/api/fdh/claim-batch/claim";
import { chunkIds, mergeChecks, mergePreviews, type MergedPreview } from "./batch";
// shortcut: btn/focusRing/Skeleton/LoadError ยังอยู่ในโมดูล fund ย้ายไป src/components พร้อมกันเมื่อจัดระเบียบ fund/_components/ui
import { Skeleton, btn, focusRing } from "@/app/(app)/fund/_components/ui";
import { LoadError } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";

/** ข้อมูล 16 แฟ้มของรายที่เลือก ค่าแต่ละช่องตามที่ SQL ของแฟ้มคืน */
export type FdhPreview = { files: { file: string; columns: string[]; rows: Record<string, string | number | null | undefined>[] }[] };

/**
 * แหล่งข้อมูลของหน้า: ids = AN (ผู้ป่วยใน) หรือ VN (ผู้ป่วยนอก) ; chunkSize = รายต่อ request (ค่าที่ route รับได้) ;
 * zipPrefix ใช้ตั้งชื่อไฟล์ fdh-<prefix>-<วันที่>-<จำนวน>.zip
 */
type Source = { ids: string[]; idField: string; previewUrl: string; checkUrl: string; zipPrefix: string; chunkSize: number };

/** part = ชุดที่กำลังโหลด [ลำดับ, ทั้งหมด] */
type PreviewState = { busy: boolean; error?: string; data?: MergedPreview; file: string; version: number; part?: [number, number] };

const dash = <span className="text-muted">–</span>;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

/** โหลดทีละชุดตามลำดับ แล้วต่อแถวแต่ละแฟ้ม */
async function loadPreview(source: Source, onPart: (i: number, n: number) => void): Promise<MergedPreview> {
  const chunks = chunkIds(source.ids, source.chunkSize);
  const parts: FdhPreview[] = [];
  for (const [i, ids] of chunks.entries()) {
    onPart(i + 1, chunks.length);
    parts.push(await postJson<FdhPreview>(source.previewUrl, { [source.idField]: ids, format: "json" }));
  }
  return mergePreviews(parts);
}

/**
 * สร้าง zip ของ 16 แฟ้มใน browser จากข้อมูลที่แสดงอยู่ใน modal (ไม่อ่าน HOSxP ซ้ำ ไฟล์จึงตรงกับที่เห็น)
 * ใส่ทุกแฟ้มของชุด แฟ้มที่ไม่มีแถวเป็นหัวคอลัมน์บรรทัดเดียว ; jszip โหลดตอนกดเท่านั้น
 */
async function downloadZip(entries: [path: string, data: string | Uint8Array][], filename: string): Promise<string | null> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, text] of entries) zip.file(path, text);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
  // SHA-256 ของไฟล์ที่ดาวน์โหลด (เก็บในบันทึกชุดส่งออก) ; crypto.subtle มีเฉพาะ https/localhost
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  return [...new Uint8Array(await subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ผลของปุ่มส่งออก: คำเตือนหลังสร้างไฟล์ และชุดที่บันทึกแล้ว (ไว้ยืนยันส่งแล้ว) */
type ZipResult = { warn?: string; batch?: { id: string; channel: Channel } };

/** บันทึกรายที่อยู่ในไฟล์เป็นหลักฐาน "ส่งออกแล้ว รอยืนยัน" ของคอลัมน์สถานะเคลม ; บันทึกไม่สำเร็จไม่กันการดาวน์โหลด คืนคำเตือนแทน */
async function logBatch(channel: Channel, files: FdhPreview["files"], source: Source, sha: string | null): Promise<ZipResult> {
  const type = source.idField === "ans" ? "IP" : "OP";
  const items = batchItems(files, type);
  if (!items.length) return {};
  try {
    const { id } = await postJson<{ id: string }>("/api/fdh/claim-batch", { channel, patient_type: type, file_sha256: sha, items });
    return { batch: { id, channel } };
  } catch (e) {
    return { warn: `ดาวน์โหลดแล้ว แต่บันทึกประวัติการส่งออกไม่สำเร็จ (${(e as Error).message}) สถานะเคลมจึงยังไม่ขึ้น "ส่งออกแล้ว"` };
  }
}

/** zip รูปแบบ FDH: ทุกแฟ้มของชุด มีหัวคอลัมน์ */
async function downloadFdh(files: FdhPreview["files"], source: Source) {
  const { toTxt } = await import("@/app/api/fdh/files/txt");
  const name = `fdh-${source.zipPrefix}-${todayIso()}-${source.ids.length}.zip`;
  const sha = await downloadZip(files.map((f) => [`${f.file}.txt`, toTxt(f.columns, f.rows)]), name);
  return logBatch("fdh", files, source, sha);
}

/**
 * zip สำหรับนำเข้า NEW e-Claim (TEXT หรือ dbf = DBF): โฟลเดอร์ละสิทธิ (นำเข้าทีละสิทธิ แนบไฟล์ในโฟลเดอร์) คืนคำเตือนเมื่อโฟลเดอร์ใดเกิน 10 MB
 * ผู้ป่วยนอก (มีแฟ้ม OPD) ขอแถวแพทย์แผนไทยตอนกด (format "eclaim-hm" ทีละชุด) เพราะ SQL สแกนทั้งตาราง ไม่ให้ FDH ต้องรอด้วย
 */
async function downloadEclaim(files: FdhPreview["files"], source: Source, dbf = false) {
  const { toEclaim, ECLAIM_MAX_BYTES } = await import("./eclaim");
  const hm: FdhPreview["files"][number]["rows"] = [];
  if (files.some((f) => f.file === "OPD"))
    for (const ids of chunkIds(source.ids, source.chunkSize))
      hm.push(...(await postJson<{ rows: typeof hm }>(source.previewUrl, { [source.idField]: ids, format: "eclaim-hm" })).rows);
  const folders = toEclaim(files, dbf ? (await import("./dbf")).writeDbf : undefined, hm);
  const name = `eclaim-${dbf ? "dbf-" : ""}${source.zipPrefix}-${todayIso()}-${source.ids.length}.zip`;
  const sha = await downloadZip(folders.flatMap((d) => d.files.map((f): [string, string | Uint8Array] => [`${d.name}/${f.name}`, f.data])), name);
  const big = folders.filter((d) => d.bytes > ECLAIM_MAX_BYTES).map((d) => `${d.name} ${(d.bytes / 1024 / 1024).toFixed(1)} MB`);
  const logged = await logBatch(dbf ? "eclaim_dbf" : "eclaim_txt", files, source, sha);
  const warn = [big.length ? `เกิน 10 MB ต่อการนำเข้า: ${big.join(", ")} เลือกรายน้อยลงแล้วส่งออกหลายครั้ง` : "", logged.warn].filter(Boolean).join(" ; ");
  return { ...logged, warn: warn || undefined };
}

/** ปุ่มส่งออก zip พร้อมป้ายเตือนว่ายังไม่ได้ทดสอบกับระบบปลายทาง (ไม่ส่ง target = ไม่มีป้าย) ; make คืนคำเตือนและชุดที่บันทึก (ส่งต่อ onBatch) */
function ZipButton({ target, label, make, onBatch }: { target?: string; label: string; make: () => Promise<ZipResult>; onBatch: (b: NonNullable<ZipResult["batch"]>) => void }) {
  const [state, setState] = useState<{ busy: boolean; error?: string; warn?: string }>({ busy: false });
  async function run() {
    setState({ busy: true });
    try {
      const r = await make();
      setState({ busy: false, warn: r.warn });
      if (r.batch) onBatch(r.batch);
    } catch (e) {
      setState({ busy: false, error: `สร้างไฟล์ไม่สำเร็จ: ${(e as Error).message}` });
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {target && <span className="rounded border border-warning-line bg-warning-soft px-1.5 py-0.5 text-xs text-warning">ยังไม่ได้ทดสอบกับ {target}</span>}
      <button type="button" disabled={state.busy} onClick={run} className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}>
        {state.busy ? "กำลังสร้างไฟล์…" : label}
      </button>
      {state.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
      {state.warn && <p role="status" className="w-full text-xs text-warning">{state.warn}</p>}
    </div>
  );
}

type PreviewFile = FdhPreview["files"][number];
type RowIssue = { codes: string[]; found?: string };
/** ระดับสูงสุดของแถว: error = ติด C ; warn = อาจถูกตีกลับ ; info = ข้อมูล ไม่นับเป็นติด C (กฎ STP) */
const rowLevel = (x: RowIssue): Level =>
  x.codes.some((c) => codeLevel(c) === "error") ? "error" : x.codes.some((c) => codeLevel(c) === "warn") ? "warn" : "info";
/** badge รหัสตามระดับ */
const CODE_TONE: Record<Level, string> = { error: "bg-c-fail text-c-fail-fg", warn: "bg-warning-soft text-warning", info: "bg-surface-sunken text-muted" };
const LEVEL_NOTE: Record<Level, string> = { error: "", warn: " (เตือน ยังไม่ยืนยันว่าตีกลับ)", info: " (ข้อมูล ไม่นับเป็นติด C)" };
type XlsxSheet = { name: string; columns: string[]; rows: Record<string, string | number | null | undefined>[] };

/** ส่งออก Excel หนึ่ง sheet ต่อแฟ้ม (สร้างที่ server จากข้อมูลที่แสดงอยู่ รวมผลตรวจ C) */
async function downloadXlsx(sheets: XlsxSheet[], filename: string) {
  const body = JSON.stringify({ filename, sheets });
  // เกินขนาดนี้ proxy ตัด body เงียบ server จะได้ JSON ไม่ครบ
  if (new Blob([body]).size > XLSX_MAX_BODY) throw new Error("ข้อมูลใหญ่เกินกว่าจะสร้าง Excel ได้ ใช้ไฟล์ zip แทน");
  const res = await fetch("/api/fdh/files/xlsx", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

/**
 * หลังส่งออกและบันทึกชุดแล้ว: ยืนยันว่าอัปโหลดขึ้นระบบปลายทางแล้ว (สถานะเคลม "ส่งแล้ว") ไม่บังคับ
 * ยืนยันภายหลังหรือยกเลิกชุดที่ส่งออกผิดได้ที่ /fdh/claim-batch
 */
function ConfirmExport({ batch }: { batch: NonNullable<ZipResult["batch"]> }) {
  const [state, setState] = useState<{ busy: boolean; done?: boolean; error?: string }>({ busy: false });
  const target = batch.channel === "fdh" ? "FDH" : "e-Claim";
  async function confirm() {
    setState({ busy: true });
    const res = await fetch("/api/fdh/claim-batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", ids: [batch.id] }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) return setState({ busy: false, error: body?.error ?? (res ? `ยืนยันไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้") });
    if (!body?.confirmed?.length) return setState({ busy: false, error: "ยืนยันไม่ได้: ชุดนี้ถูกยกเลิกหรือยืนยันไปแล้ว" });
    setState({ busy: false, done: true });
  }
  const history = (
    <Link href="/fdh/claim-batch" className={`text-accent-text underline underline-offset-2 ${focusRing}`}>
      ประวัติส่งออกเคลม
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm">
      {state.done ? (
        <p role="status" className="text-success">
          ยืนยันส่งแล้ว ชุด #{batch.id} สถานะเคลมของรายในชุดเป็น &quot;ส่งแล้ว&quot; ดูได้ที่ {history}
        </p>
      ) : (
        <>
          <span>
            ชุด #{batch.id} ยืนยันว่าอัปโหลดขึ้น {target} แล้ว
          </span>
          <button type="button" disabled={state.busy} onClick={confirm} className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}>
            {state.busy ? "กำลังบันทึก…" : "ยืนยันส่งแล้ว"}
          </button>
          <span className="text-muted">ยืนยันภายหลังได้ที่ {history}</span>
        </>
      )}
      {state.error && (
        <p role="alert" className="w-full text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}

function XlsxButton({ build, filename, label, rows }: { build: () => XlsxSheet[]; filename: string; label: string; rows: number }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  async function run() {
    setState({ busy: true });
    try {
      const sheets = build();
      if (!sheets.length) throw new Error("ไม่มีแถวให้ส่งออก");
      await downloadXlsx(sheets, filename);
      setState({ busy: false });
    } catch (e) {
      setState({ busy: false, error: `ส่งออก Excel ไม่สำเร็จ: ${(e as Error).message}` });
    }
  }
  if (rows > XLSX_MAX_ROWS) return <span className="text-xs text-muted">Excel ได้ไม่เกิน {formatCount(XLSX_MAX_ROWS)} แถว ใช้ไฟล์ zip แทน</span>;
  return (
    <>
      <button type="button" disabled={state.busy} onClick={run} className={`${btn} disabled:cursor-wait disabled:opacity-60`}>
        {state.busy ? "กำลังสร้างไฟล์…" : label}
      </button>
      {state.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </>
  );
}
/** ผลตรวจหนึ่งแฟ้ม: pending รอคิว, running กำลังตรวจ (part = ชุดที่ตรวจอยู่ เมื่อมีหลายชุด), done เสร็จ (issues = แถวที่ไม่ผ่าน), error ตรวจไม่สำเร็จ */
type FileCheck = { status: "pending" | "running" | "done" | "error"; issues: Map<number, RowIssue>; rules: string[]; note?: string; error?: string; truncated?: boolean; part?: string };
/** จำนวนแถวที่ระดับสูงสุดเป็น lvl */
const countLevel = (c: FileCheck | undefined, lvl: Level) => [...(c?.issues.values() ?? [])].filter((x) => rowLevel(x) === lvl).length;
/** แถวที่ต้องดู (ติด C หรือเตือน) ไม่รวมแถวที่มีแต่ระดับข้อมูล */
const flagged = (c?: FileCheck) => [...(c?.issues ?? [])].filter(([, x]) => rowLevel(x) !== "info").map(([i]) => i);

/**
 * จับคู่ผลตรวจเข้าแถวของแฟ้มที่แสดง: row = ลำดับแถว (DRU ที่ SQL ตรวจเรียงเหมือนแฟ้ม) ; PAT ใช้ HN ;
 * มี an = ผู้ป่วยใน (INS เทียบ SEQ ด้วย) ; ไม่มี an แต่มี seq = ผู้ป่วยนอก เทียบ SEQ (= VN)
 */
function mapIssues(file: PreviewFile, findings: CheckFinding[]): Map<number, RowIssue> {
  const issues = new Map<number, RowIssue>();
  const add = (i: number, f: CheckFinding) => {
    const cur = issues.get(i) ?? { codes: [] };
    issues.set(i, { codes: [...new Set([...cur.codes, ...f.codes])], found: [cur.found, f.found].filter(Boolean).join(" · ") || undefined });
  };
  const val = (r: PreviewFile["rows"][number], c: string) => (r[c] == null ? "" : String(r[c]));
  for (const f of findings) {
    if (f.row != null) {
      add(f.row, f);
      continue;
    }
    file.rows.forEach((r, i) => {
      const hit =
        file.file === "PAT"
          ? val(r, "HN") === f.hn
          : f.an
            ? val(r, "AN") === f.an && (file.file !== "INS" || !f.seq || val(r, "SEQ") === f.seq)
            : !!f.seq && val(r, "SEQ") === f.seq;
      if (hit) add(i, f);
    });
  }
  return issues;
}

/** แถบความคืบหน้าของแฟ้มในรายการซ้าย */
function CheckBar({ check }: { check?: FileCheck }) {
  if (!check) return null;
  // ระหว่างรอ/กำลังตรวจ = ส้มอ่อน ; เสร็จแล้ว ไม่พบ C = เขียว, พบ C หรือตรวจไม่สำเร็จ = แดง, มีแต่เตือน = เหลือง, ไม่มีกฎ = เทา
  const tone =
    check.status === "pending" || check.status === "running"
      ? "bg-check-soft"
      : check.status === "error" || countLevel(check, "error")
        ? "bg-c-fail"
        : countLevel(check, "warn")
          ? "bg-warning"
          : check.rules.length
            ? "bg-success"
            : "bg-line";
  const width = check.status === "pending" ? "w-0" : check.status === "running" ? "w-1/2 motion-safe:animate-pulse" : "w-full";
  return (
    <span aria-hidden="true" className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
      <span className={`block h-full rounded-full transition-[width] duration-300 ${tone} ${width}`} />
    </span>
  );
}

function checkLabel(check?: FileCheck) {
  if (!check) return null;
  if (check.status === "pending") return "รอตรวจ";
  if (check.status === "running") return check.part ? `กำลังตรวจ ชุด ${check.part}` : "กำลังตรวจ";
  if (check.status === "error") return "ตรวจไม่สำเร็จ";
  if (!check.rules.length) return check.note ? "ตรวจไม่ได้" : "ไม่มีกฎ";
  const errors = countLevel(check, "error"), warns = countLevel(check, "warn");
  return errors ? `ไม่ผ่าน ${formatCount(errors)} แถว` : warns ? `เตือน ${formatCount(warns)} แถว` : "ผ่าน";
}

/** เนื้อหา modal หลังโหลด 16 แฟ้มแล้ว: ปุ่มตรวจ C (ซ้ายบน) ส่งออก zip (ขวาบน) รายการแฟ้ม (ซ้าย) และข้อมูลแฟ้ม (ขวา) ; counts = แถวต่อชุดของแต่ละแฟ้ม ; allFiles = ทุกแฟ้มรวมแฟ้มว่าง (ใส่ใน zip) */
function PreviewContent({ files, allFiles, counts, file, onFile, source }: { files: PreviewFile[]; allFiles: PreviewFile[]; counts: MergedPreview["counts"]; file: string; onFile: (f: string) => void; source: Source }) {
  const [checks, setChecks] = useState<Record<string, FileCheck>>({});
  const [info, setInfo] = useState<Record<string, string>>({});
  const [onlyC, setOnlyC] = useState(false);
  const [exported, setExported] = useState<NonNullable<ZipResult["batch"]> | null>(null);
  const running = Object.values(checks).some((c) => c.status === "pending" || c.status === "running");
  // เฉพาะแถวที่ติด C/เตือน: แสดงเฉพาะแฟ้มที่มีแถวเหล่านั้น และเฉพาะแถวนั้น (แถวที่มีแต่ระดับข้อมูลไม่นับ)
  const failedFiles = files.filter((f) => flagged(checks[f.file]).length > 0);
  const filtering = onlyC && failedFiles.length > 0;
  const shownFiles = filtering ? failedFiles : files;
  const current = shownFiles.find((f) => f.file === file) ?? shownFiles[0];
  const rowIndexes = (f: PreviewFile) => (filtering ? flagged(checks[f.file]).sort((a, b) => a - b) : f.rows.map((_, i) => i));

  /** sheet ต่อแฟ้มตามมุมมองปัจจุบัน (กรองติด C อยู่ = เฉพาะแถวที่ติด C) ตรวจแล้วมีคอลัมน์รหัส C และคำอธิบายนำหน้า */
  function buildSheets(): XlsxSheet[] {
    return shownFiles.flatMap((f) => {
      const c = checks[f.file];
      const checked = c?.status === "done";
      const rows = rowIndexes(f).map((i) => {
        const issue = c?.issues.get(i);
        const extra = checked
          ? {
              "ติด C": issue ? issue.codes.map(cLabel).join(", ") : "",
              "รายละเอียด C": issue ? [...issue.codes.map((code) => `${cLabel(code)} ${info[code] ?? ""}`.trim()), issue.found].filter(Boolean).join(" | ") : "",
            }
          : {};
        return { ...extra, ...f.rows[i] };
      });
      return rows.length ? [{ name: f.file, columns: [...(checked ? ["ติด C", "รายละเอียด C"] : []), ...f.columns], rows }] : [];
    });
  }

  /** ตรวจทีละแฟ้ม แต่ละแฟ้มทีละชุดตามลำดับ (แสดงความคืบหน้าต่อแฟ้มและชุด) */
  async function runCheck() {
    const empty = { issues: new Map<number, RowIssue>(), rules: [] as string[] };
    const chunks = chunkIds(source.ids, source.chunkSize);
    setChecks(Object.fromEntries(files.map((f) => [f.file, { status: "pending", ...empty }])));
    for (const f of files) {
      try {
        const parts: CheckResult[] = [];
        for (const [i, ids] of chunks.entries()) {
          setChecks((c) => ({ ...c, [f.file]: { status: "running", ...empty, part: chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined } }));
          parts.push(await postJson<CheckResult>(source.checkUrl, { [source.idField]: ids, file: f.file }));
          // แฟ้มที่ไม่มีกฎ route ตอบว่างทันที ไม่ต้องยิงชุดอื่น
          if (!parts[0].rules.length && !parts[0].note) break;
        }
        const r = mergeChecks(parts, counts[f.file]);
        setInfo((i) => ({ ...i, ...r.info }));
        setChecks((c) => ({ ...c, [f.file]: { status: "done", issues: mapIssues(f, r.findings), rules: r.rules, note: r.note, truncated: r.truncated } }));
      } catch (e) {
        setChecks((c) => ({ ...c, [f.file]: { status: "error", ...empty, error: (e as Error).message } }));
      }
    }
  }

  const done = Object.values(checks).filter((c) => c.status === "done" || c.status === "error").length;
  const failed = Object.values(checks).reduce((n, c) => n + countLevel(c, "error"), 0);
  const warned = Object.values(checks).reduce((n, c) => n + countLevel(c, "warn"), 0);
  const check = checks[current.file];
  const notes = Object.entries(checks).filter(([, c]) => c.note || c.error || c.truncated);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={running}
            onClick={runCheck}
            className={`inline-flex h-9 items-center justify-center rounded-md border border-check bg-check px-3 text-sm font-medium text-check-fg hover:opacity-90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
          >
            {running ? "กำลังตรวจ C…" : Object.keys(checks).length ? "ตรวจ C อีกครั้ง" : "ตรวจ C"}
          </button>
          {Object.keys(checks).length > 0 && (
            <span role="status" className="text-muted tabular-nums">
              ตรวจแล้ว {formatCount(done)}/{formatCount(files.length)} แฟ้ม
              {!running && failed > 0 && <span className="ml-2 font-medium text-danger">ไม่ผ่าน {formatCount(failed)} แถว</span>}
              {!running && warned > 0 && <span className="ml-2 font-medium text-warning">เตือน {formatCount(warned)} แถว</span>}
              {!running && !failed && !warned && <span className="ml-2 font-medium text-success">ไม่พบจากกฎที่มี</span>}
            </span>
          )}
          {failed + warned > 0 && (
            <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap">
              <input type="checkbox" checked={onlyC} onChange={(e) => setOnlyC(e.target.checked)} className={`size-4 cursor-pointer accent-[var(--accent)] ${focusRing}`} />
              เฉพาะแถวที่ติด C/เตือน
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <XlsxButton
            build={buildSheets}
            rows={shownFiles.reduce((n, f) => n + rowIndexes(f).length, 0)}
            filename={`fdh-${source.zipPrefix}-${todayIso()}-${source.ids.length}${filtering ? "-c" : ""}.xlsx`}
            label={filtering ? "ส่งออก Excel (เฉพาะที่ติด C/เตือน)" : "ส่งออก Excel"}
          />
          <ZipButton
            target="FDH"
            label={`ส่งออก 16 แฟ้ม (.zip) ${formatCount(allFiles.length)} แฟ้ม`}
            make={() => downloadFdh(allFiles, source)}
            onBatch={setExported}
          />
          <ZipButton target="e-Claim" label="ส่งออก e-Claim (.zip)" make={() => downloadEclaim(allFiles, source)} onBatch={setExported} />
          {/* ใช้ป้าย "ยังไม่ได้ทดสอบกับ e-Claim" ร่วมกับปุ่ม TEXT ข้างหน้า */}
          <ZipButton label="ส่งออก e-Claim (.dbf)" make={() => downloadEclaim(allFiles, source, true)} onBatch={setExported} />
        </div>
      </div>
      {exported && <ConfirmExport key={exported.id} batch={exported} />}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-warning">
          {notes.map(([f, c]) => (
            <li key={f}>
              {f}: {c.error ? `ตรวจไม่สำเร็จ ${c.error}` : c.note ?? "รายการ C เกิน 1,000 เคสต่อชุด ผลอาจไม่ครบ"}
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-h-0 flex-col gap-4 text-sm md:flex-row">
        <nav aria-label="แฟ้ม" className="flex shrink-0 flex-wrap gap-1 md:w-44 md:flex-col">
          {shownFiles.map((f) => {
            const on = f.file === current.file;
            const c = checks[f.file];
            const label = checkLabel(c);
            return (
              <button
                key={f.file}
                type="button"
                aria-pressed={on}
                onClick={() => onFile(f.file)}
                className={`flex min-w-28 flex-col rounded-md px-2.5 py-1.5 text-left ${focusRing} ${on ? "bg-accent-soft text-accent-text" : "hover:bg-hover"}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className={on ? "font-semibold" : ""}>{f.file}</span>
                  <span className="tabular-nums">{formatCount(filtering ? flagged(c).length : f.rows.length)}</span>
                </span>
                <CheckBar check={c} />
                {label && (
                  <span className={`mt-0.5 text-xs ${countLevel(c, "error") || c?.status === "error" ? "text-danger" : countLevel(c, "warn") ? "text-warning" : "text-muted"}`}>{label}</span>
                )}
              </button>
            );
          })}
        </nav>
        <section aria-label={`แฟ้ม ${current.file}`} className="min-w-0 flex-1">
          <h3 className="mb-2 font-semibold">
            แฟ้ม {current.file}{" "}
            <span className="font-normal text-muted tabular-nums">
              {filtering ? `ติด C/เตือน ${formatCount(flagged(check).length)} จาก ${formatCount(current.rows.length)} แถว` : `${formatCount(current.rows.length)} แถว`}
            </span>
            {check?.status === "done" && check.rules.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted">ตรวจ {check.rules.map(cLabel).join(", ")}</span>
            )}
          </h3>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-grid-cell tabular-nums">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  {check?.status === "done" && <th scope="col" className="px-2.5 py-1.5 font-medium whitespace-nowrap">ติด C</th>}
                  {current.columns.map((c) => (
                    <th key={c} scope="col" className="px-2.5 py-1.5 font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowIndexes(current).map((i) => {
                  const r = current.rows[i];
                  const issue = check?.issues.get(i);
                  const level = issue && rowLevel(issue);
                  // ทั้งแถวเป็นสีเฉพาะ error (แดง) / warn (เหลือง) ; info แสดงแค่ badge จาง
                  const rowTone = level === "error" ? "bg-c-fail text-c-fail-fg" : level === "warn" ? "bg-warning-soft" : "hover:bg-surface-sunken";
                  return (
                    <tr key={i} className={`border-t border-line ${rowTone}`}>
                      {check?.status === "done" && (
                        <td className="px-2.5 py-1 whitespace-nowrap" title={issue?.found}>
                          {issue ? (
                            <span className="flex gap-1">
                              {issue.codes.map((code) => (
                                <span key={code} title={`${info[code] ?? ""}${LEVEL_NOTE[codeLevel(code)]}`} className={`rounded border border-current px-1 text-xs font-semibold ${CODE_TONE[codeLevel(code)]}`}>{cLabel(code)}</span>
                              ))}
                            </span>
                          ) : (
                            dash
                          )}
                        </td>
                      )}
                      {current.columns.map((c) => (
                        <td key={c} className="px-2.5 py-1 whitespace-nowrap">{r[c] == null || r[c] === "" ? dash : String(r[c])}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {check?.status === "done" && check.issues.size > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
              {[...new Set([...check.issues.values()].flatMap((x) => x.codes))].map((code) => (
                <li key={code}>
                  <span className={`rounded px-1 font-medium ${CODE_TONE[codeLevel(code)]}`}>{cLabel(code)}</span> {info[code] ?? ""}
                  {LEVEL_NOTE[codeLevel(code)]}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** เนื้อหา modal 16 แฟ้ม: โหลด / error / ข้อมูล (แฟ้มที่ไม่มีแถวไม่แสดง แต่ zip ใส่ครบทุกแฟ้ม) */
function PreviewBody({ state, onFile, onRetry, source }: { state: PreviewState; onFile: (f: string) => void; onRetry: () => void; source: Source }) {
  if (state.busy)
    return (
      <div className="flex flex-col gap-2">
        {state.part && state.part[1] > 1 && (
          <p role="status" className="text-sm text-muted tabular-nums">
            กำลังโหลด ชุด {formatCount(state.part[0])}/{formatCount(state.part[1])}
          </p>
        )}
        <Skeleton rows={8} />
      </div>
    );
  if (state.error || !state.data) return <LoadError what="16 แฟ้ม" error={state.error} retry={onRetry} />;
  const files = state.data.files.filter((f) => f.rows.length);
  if (!files.length) return <p className="text-sm text-muted">ไม่มีข้อมูลใน 16 แฟ้มสำหรับรายที่เลือก</p>;
  // โหลดข้อมูลชุดใหม่ = ผลตรวจเดิมใช้ไม่ได้ (key เปลี่ยนตามรอบที่โหลด)
  return <PreviewContent key={state.version} files={files} allFiles={state.data.files} counts={state.data.counts} file={state.file} onFile={onFile} source={source} />;
}

/**
 * modal 16 แฟ้มของรายที่เลือก: เปิด = โหลดข้อมูลชุดใหม่ (ids ณ ตอนเปิด) ปิดแล้วเปิดใหม่ = โหลดใหม่
 * unit = หน่วยที่แสดงในหัว modal เช่น "ราย" หรือ "visit"
 */
export function FdhPreviewModal({
  open,
  onClose,
  ids,
  idField,
  previewUrl,
  checkUrl,
  zipPrefix,
  chunkSize,
  unit,
}: Source & { open: boolean; onClose: () => void; unit: string }) {
  const [state, setState] = useState<PreviewState>({ busy: false, file: "", version: 0 });
  const [source, setSource] = useState<Source>({ ids, idField, previewUrl, checkUrl, zipPrefix, chunkSize });
  const latest = useRef<Source>({ ids, idField, previewUrl, checkUrl, zipPrefix, chunkSize });
  latest.current = { ids, idField, previewUrl, checkUrl, zipPrefix, chunkSize };

  async function load() {
    const src = latest.current;
    setSource(src);
    setState((p) => ({ ...p, busy: true, error: undefined, part: undefined }));
    try {
      const data = await loadPreview(src, (i, n) => setState((p) => ({ ...p, part: [i, n] })));
      setState((p) => ({ ...p, busy: false, data, version: p.version + 1, file: data.files.find((f) => f.file === p.file)?.file ?? data.files[0]?.file ?? "" }));
    } catch (e) {
      setState((p) => ({ ...p, busy: false, error: (e as Error).message }));
    }
  }

  useEffect(() => {
    if (open) void load();
    // โหลดเฉพาะตอนเปิด (ids อ่านจาก ref ณ ตอนนั้น)
  }, [open]);

  return (
    <DetailModal
      open={open}
      onClose={onClose}
      size="wide"
      title={
        <>
          16 แฟ้ม <span className="ml-1 font-normal text-muted tabular-nums">{formatCount(source.ids.length)} {unit}</span>
        </>
      }
    >
      <PreviewBody state={state} onFile={(file) => setState((p) => ({ ...p, file }))} onRetry={load} source={source} />
    </DetailModal>
  );
}
