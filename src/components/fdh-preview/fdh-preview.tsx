"use client";

// modal 16 แฟ้ม (ดูข้อมูลรายแฟ้ม, ตรวจ C ทีละแฟ้มพร้อมแถบความคืบหน้า, ส่งออก txt ใน zip) ใช้ร่วม /ipd/admissions และ /opd/admissions
// ข้อมูลมาจาก endpoint ของหน้า (POST { [idField]: ids, format: "json" }) ตรวจ C ผ่าน checkUrl (POST { [idField]: ids, file })
import { useEffect, useRef, useState } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { todayIso } from "@/lib/thai-date";
import { cLabel } from "@/app/api/fdh/c-check/files";
import type { CheckFinding, CheckResult } from "@/app/api/ipd/fdh-check/check";
// shortcut: btn/focusRing/Skeleton/LoadError ยังอยู่ในโมดูล fund ย้ายไป src/components พร้อมกันเมื่อจัดระเบียบ fund/_components/ui
import { Skeleton, btn, focusRing } from "@/app/(app)/fund/_components/ui";
import { LoadError } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";

/** ข้อมูล 16 แฟ้มของรายที่เลือก ค่าแต่ละช่องตามที่ SQL ของแฟ้มคืน */
export type FdhPreview = { files: { file: string; columns: string[]; rows: Record<string, string | number | null | undefined>[] }[] };

/** แหล่งข้อมูลของหน้า: ids = AN (ผู้ป่วยใน) หรือ VN (ผู้ป่วยนอก) ; zipPrefix ใช้ตั้งชื่อไฟล์ fdh-<prefix>-<วันที่>-<จำนวน>.zip */
type Source = { ids: string[]; idField: string; previewUrl: string; checkUrl: string; zipPrefix: string };

type PreviewState = { busy: boolean; error?: string; data?: FdhPreview; file: string; version: number };

const dash = <span className="text-muted">–</span>;

async function loadPreview(source: Source): Promise<FdhPreview> {
  const res = await fetch(source.previewUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [source.idField]: source.ids, format: "json" }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

/**
 * สร้าง zip ของ 16 แฟ้มใน browser จากข้อมูลที่แสดงอยู่ใน modal (ไม่อ่าน HOSxP ซ้ำ ไฟล์จึงตรงกับที่เห็น)
 * ใส่เฉพาะแฟ้มที่มีแถว แบบโปรแกรมที่ส่ง FDH จริง ; jszip โหลดตอนกดเท่านั้น
 */
async function downloadZip(files: FdhPreview["files"], n: number, prefix: string) {
  const [{ default: JSZip }, { toTxt }] = await Promise.all([import("jszip"), import("@/app/api/fdh/files/txt")]);
  const zip = new JSZip();
  for (const f of files) if (f.rows.length) zip.file(`${f.file}.txt`, toTxt(f.columns, f.rows));
  const url = URL.createObjectURL(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }));
  Object.assign(document.createElement("a"), { href: url, download: `fdh-${prefix}-${todayIso()}-${n}.zip` }).click();
  URL.revokeObjectURL(url);
}

/** ปุ่มส่งออก 16 แฟ้มเป็น txt ใน zip พร้อมป้ายเตือนว่ายังไม่ได้ทดสอบกับ FDH */
function ZipButton({ files, n, prefix }: { files: FdhPreview["files"]; n: number; prefix: string }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const nonEmpty = files.filter((f) => f.rows.length).length;
  async function run() {
    setState({ busy: true });
    try {
      await downloadZip(files, n, prefix);
      setState({ busy: false });
    } catch (e) {
      setState({ busy: false, error: `สร้างไฟล์ไม่สำเร็จ: ${(e as Error).message}` });
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded border border-warning-line bg-warning-soft px-1.5 py-0.5 text-xs text-warning">ยังไม่ได้ทดสอบกับ FDH</span>
      <button type="button" disabled={!nonEmpty || state.busy} onClick={run} className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}>
        {state.busy ? "กำลังสร้างไฟล์…" : `ส่งออก 16 แฟ้ม (.zip) ${formatCount(nonEmpty)} แฟ้ม`}
      </button>
      {state.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </div>
  );
}

type PreviewFile = FdhPreview["files"][number];
type RowIssue = { codes: string[]; found?: string };
/** ผลตรวจหนึ่งแฟ้ม: pending รอคิว, running กำลังตรวจ, done เสร็จ (issues = แถวที่ไม่ผ่าน), error ตรวจไม่สำเร็จ */
type FileCheck = { status: "pending" | "running" | "done" | "error"; issues: Map<number, RowIssue>; rules: string[]; note?: string; error?: string; truncated?: boolean };

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
  // ระหว่างรอ/กำลังตรวจ = ส้มอ่อน ; เสร็จแล้ว ไม่พบ C = เขียว, พบ C หรือตรวจไม่สำเร็จ = แดง, ไม่มีกฎ = เทา
  const tone =
    check.status === "pending" || check.status === "running"
      ? "bg-check-soft"
      : check.status === "error" || check.issues.size
        ? "bg-c-fail"
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
  if (check.status === "running") return "กำลังตรวจ";
  if (check.status === "error") return "ตรวจไม่สำเร็จ";
  if (!check.rules.length) return check.note ? "ตรวจไม่ได้" : "ไม่มีกฎ";
  return check.issues.size ? `ไม่ผ่าน ${formatCount(check.issues.size)} แถว` : "ผ่าน";
}

/** ตรวจ C ทีละแฟ้มตามลำดับ (แสดงความคืบหน้าต่อแฟ้ม) */
async function checkFile(url: string, idField: string, ids: string[], file: string): Promise<CheckResult> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [idField]: ids, file }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

/** เนื้อหา modal หลังโหลด 16 แฟ้มแล้ว: ปุ่มตรวจ C (ซ้ายบน) ส่งออก zip (ขวาบน) รายการแฟ้ม (ซ้าย) และข้อมูลแฟ้ม (ขวา) */
function PreviewContent({ files, file, onFile, source }: { files: PreviewFile[]; file: string; onFile: (f: string) => void; source: Source }) {
  const [checks, setChecks] = useState<Record<string, FileCheck>>({});
  const [info, setInfo] = useState<Record<string, string>>({});
  const running = Object.values(checks).some((c) => c.status === "pending" || c.status === "running");
  const current = files.find((f) => f.file === file) ?? files[0];

  async function runCheck() {
    const empty = { issues: new Map<number, RowIssue>(), rules: [] as string[] };
    setChecks(Object.fromEntries(files.map((f) => [f.file, { status: "pending", ...empty }])));
    for (const f of files) {
      setChecks((c) => ({ ...c, [f.file]: { status: "running", ...empty } }));
      try {
        const r = await checkFile(source.checkUrl, source.idField, source.ids, f.file);
        setInfo((i) => ({ ...i, ...r.info }));
        setChecks((c) => ({ ...c, [f.file]: { status: "done", issues: mapIssues(f, r.findings), rules: r.rules, note: r.note, truncated: r.truncated } }));
      } catch (e) {
        setChecks((c) => ({ ...c, [f.file]: { status: "error", ...empty, error: (e as Error).message } }));
      }
    }
  }

  const done = Object.values(checks).filter((c) => c.status === "done" || c.status === "error").length;
  const failed = Object.values(checks).reduce((n, c) => n + c.issues.size, 0);
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
              {!running && (failed ? <span className="ml-2 font-medium text-danger">ไม่ผ่าน {formatCount(failed)} แถว</span> : <span className="ml-2 font-medium text-success">ไม่พบจากกฎที่มี</span>)}
            </span>
          )}
        </div>
        <ZipButton files={files} n={source.ids.length} prefix={source.zipPrefix} />
      </div>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-warning">
          {notes.map(([f, c]) => (
            <li key={f}>
              {f}: {c.error ? `ตรวจไม่สำเร็จ ${c.error}` : c.note ?? "รายการ C ทั้งช่วงเกิน 1,000 เคส ผลอาจไม่ครบ"}
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-h-0 flex-col gap-4 text-sm md:flex-row">
        <nav aria-label="แฟ้ม" className="flex shrink-0 flex-wrap gap-1 md:w-44 md:flex-col">
          {files.map((f) => {
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
                  <span className="tabular-nums">{formatCount(f.rows.length)}</span>
                </span>
                <CheckBar check={c} />
                {label && <span className={`mt-0.5 text-xs ${c?.issues.size || c?.status === "error" ? "text-danger" : "text-muted"}`}>{label}</span>}
              </button>
            );
          })}
        </nav>
        <section aria-label={`แฟ้ม ${current.file}`} className="min-w-0 flex-1">
          <h3 className="mb-2 font-semibold">
            แฟ้ม {current.file} <span className="font-normal text-muted tabular-nums">{formatCount(current.rows.length)} แถว</span>
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
                {current.rows.map((r, i) => {
                  const issue = check?.issues.get(i);
                  return (
                    <tr key={i} className={`border-t border-line ${issue ? "bg-c-fail text-c-fail-fg" : "hover:bg-surface-sunken"}`}>
                      {check?.status === "done" && (
                        <td className="px-2.5 py-1 whitespace-nowrap" title={issue?.found}>
                          {issue ? (
                            <span className="flex gap-1">
                              {issue.codes.map((code) => (
                                <span key={code} title={info[code]} className="rounded border border-c-fail-fg px-1 text-xs font-semibold">{cLabel(code)}</span>
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
                  <span className="rounded bg-c-fail px-1 font-medium text-c-fail-fg">{cLabel(code)}</span> {info[code] ?? ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** เนื้อหา modal 16 แฟ้ม: โหลด / error / ข้อมูล (แฟ้มที่ไม่มีแถวไม่แสดง เหมือน zip ที่ไม่ใส่แฟ้มว่าง) */
function PreviewBody({ state, onFile, onRetry, source }: { state: PreviewState; onFile: (f: string) => void; onRetry: () => void; source: Source }) {
  if (state.busy) return <Skeleton rows={8} />;
  if (state.error || !state.data) return <LoadError what="16 แฟ้ม" error={state.error} retry={onRetry} />;
  const files = state.data.files.filter((f) => f.rows.length);
  if (!files.length) return <p className="text-sm text-muted">ไม่มีข้อมูลใน 16 แฟ้มสำหรับรายที่เลือก</p>;
  // โหลดข้อมูลชุดใหม่ = ผลตรวจเดิมใช้ไม่ได้ (key เปลี่ยนตามรอบที่โหลด)
  return <PreviewContent key={state.version} files={files} file={state.file} onFile={onFile} source={source} />;
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
  unit,
}: Source & { open: boolean; onClose: () => void; unit: string }) {
  const [state, setState] = useState<PreviewState>({ busy: false, file: "", version: 0 });
  const [source, setSource] = useState<Source>({ ids, idField, previewUrl, checkUrl, zipPrefix });
  const latest = useRef<Source>({ ids, idField, previewUrl, checkUrl, zipPrefix });
  latest.current = { ids, idField, previewUrl, checkUrl, zipPrefix };

  async function load() {
    const src = latest.current;
    setSource(src);
    setState((p) => ({ ...p, busy: true, error: undefined }));
    try {
      const data = await loadPreview(src);
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
