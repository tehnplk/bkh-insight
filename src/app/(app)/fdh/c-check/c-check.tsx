"use client";

import { useState } from "react";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatCount } from "@/lib/number-format";
// ชิ้นส่วนของโมดูลอื่นที่ยังไม่ได้ย้ายไป src/components (ใช้ซ้ำ ไม่สร้างใหม่)
import { FilterChip, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "@/app/(app)/fund/_components/ui";
import { Segmented } from "@/app/(app)/quality/pending/segmented";
import {
  DATE_LABEL, FDH_TYPES, FILE_ORDER, RULE_CODE_COUNT, STP_RULES, TYPE_LABEL, cLabel, codeLevel,
  type CaseRow, type FdhType, type Level, type SummaryFile, type SummaryResponse, type ValidateResponse,
} from "@/app/api/fdh/c-check/files";

const TYPE_OPTIONS = FDH_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }));
const dash = <span className="text-muted">–</span>;
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5 align-top";
const LEVEL: Record<Level, { label: string; className: string }> = {
  error: { label: "ผิดพลาด", className: "bg-danger-soft text-danger" },
  warn: { label: "เตือน", className: "bg-warning-soft text-warning" },
  info: { label: "ข้อมูล", className: "bg-surface-sunken text-muted" },
};
const STP_COUNT = Object.keys(STP_RULES).length;

/** badge จำนวนเคส: มีเคส = สีตามระดับสูงสุดที่พบ (ผิดพลาด/เตือน/ข้อมูล), 0 = จาง, ยังไม่มีกฎ = ไม่แสดง */
function CaseBadge({ info, loading }: { info?: SummaryFile; loading: boolean }) {
  if (loading) return <span className="h-4 w-6 animate-pulse rounded bg-hover" aria-hidden="true" />;
  if (!info || info.cases === null) return null;
  const level = LEVEL[info.level ?? "error"];
  return (
    <span
      title={info.cases ? `ระดับสูงสุด: ${level.label}` : undefined}
      className={`min-w-6 rounded px-1.5 text-center text-xs tabular-nums ${info.cases ? `${level.className} font-semibold` : "text-muted"}`}
    >
      {formatCount(info.cases)}
    </span>
  );
}

const fileOptionLabel = (file: string, info?: SummaryFile) =>
  info?.cases ? `${file} (${formatCount(info.cases)} เคส)` : info?.cases === 0 ? `${file} (0)` : file;

function FileTabs({ type, file, summary, loading, onSelect }: {
  type: FdhType; file: string; summary?: SummaryResponse; loading: boolean; onSelect: (f: string) => void;
}) {
  const info = (f: string) => summary?.files.find((x) => x.file === f);
  return (
    <>
      {/* จอแคบ: select แทนรายการแนวตั้ง */}
      <select
        aria-label="แฟ้ม"
        value={file}
        onChange={(e) => onSelect(e.target.value)}
        className={`h-9 w-full rounded-md border border-line bg-surface px-2 text-sm font-medium md:hidden ${focusRing}`}
      >
        {FILE_ORDER[type].map((f) => (
          <option key={f} value={f}>
            {fileOptionLabel(f, info(f))}
          </option>
        ))}
      </select>
      <nav aria-label="แฟ้ม" className="hidden md:block">
        <ul className="flex flex-col gap-0.5 rounded-lg border border-line p-1.5 text-sm">
          {FILE_ORDER[type].map((f) => {
            const on = f === file;
            return (
              <li key={f}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(f)}
                  className={`flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left ${
                    on ? "bg-accent-soft font-semibold text-accent-text" : "hover:bg-hover"
                  } ${focusRing}`}
                >
                  {f}
                  <CaseBadge info={info(f)} loading={loading} />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function CodeTable({ data, code, onCode }: { data: ValidateResponse; code: string; onCode: (c: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">จำนวนเคสต่อรหัส C ของแฟ้ม {data.file}</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className={th}>รหัส</th>
            <th scope="col" className={th}>ระดับ</th>
            <th scope="col" className={th}>เงื่อนไข</th>
            <th scope="col" className={`${th} ${num}`}>จำนวน</th>
            <th scope="col" className={th}>แนวทางแก้</th>
          </tr>
        </thead>
        <tbody>
          {data.summary.map((s) => {
            const on = s.c_code === code;
            return (
              <tr key={s.c_code} className={`border-t border-line ${on ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`กรองรายเคส ${cLabel(s.c_code)}`}
                    onClick={() => onCode(on ? "" : s.c_code)}
                    className={`-mx-1 rounded px-1 font-semibold whitespace-nowrap tabular-nums hover:underline ${on ? "text-accent-text" : ""} ${focusRing}`}
                  >
                    {cLabel(s.c_code)}
                  </button>
                </th>
                <td className={`${td} whitespace-nowrap`}>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LEVEL[codeLevel(s.c_code)].className}`}>{LEVEL[codeLevel(s.c_code)].label}</span>
                </td>
                <td className={`${td} min-w-48`}>{s.detail ?? <span className="text-muted">ไม่มีคำอธิบาย</span>}</td>
                <td className={`${td} ${num} font-semibold`}>{formatCount(s.n)}</td>
                <td className={`${td} min-w-48 text-muted`}>{s.fix ?? dash}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CaseTable({ rows, file }: { rows: CaseRow[]; file: string }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">รายเคสที่ติดรหัส C ของแฟ้ม {file}</caption>
        <thead className="sticky top-0 bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className={th}>รหัส</th>
            <th scope="col" className={th}>HN</th>
            <th scope="col" className={th}>AN</th>
            <th scope="col" className={th}>SEQ</th>
            <th scope="col" className={th}>ค่าที่พบ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line hover:bg-surface-sunken">
              <td className={`${td} font-medium whitespace-nowrap`}>{cLabel(r.c_code)}</td>
              <td className={`${td} whitespace-nowrap`}>{r.hn || dash}</td>
              <td className={`${td} whitespace-nowrap`}>{r.an || dash}</td>
              <td className={`${td} whitespace-nowrap`}>{r.seq || dash}</td>
              <td className={td}>{r.found?.trim() ? r.found : <span className="text-muted">ว่าง</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Result({ data, dateLabel }: { data: ValidateResponse; dateLabel: string }) {
  // key ของ Result เปลี่ยนตามหมวด/แฟ้ม/ช่วงวันที่ ตัวกรองรหัสจึงล้างเอง
  const [code, setCode] = useState("");

  if (data.rows === 0) return <Notice title="ไม่มีข้อมูลในช่วงวันที่นี้" detail={`แฟ้ม ${data.file} ไม่มีแถวตาม${dateLabel}ที่เลือก จึงยังไม่ได้ตรวจ`} />;
  if (!data.ruleCodes.length) return <Notice title="แฟ้มนี้ยังไม่มีกฎตรวจ" detail={`มี ${formatCount(data.rows)} แถว แต่ยังไม่มีรหัส C ที่ตรวจแฟ้มนี้`} />;
  if (!data.total)
    return (
      <Notice
        title={`ไม่พบจากกฎที่มี (ตรวจ ${formatCount(data.ruleCodes.length)} รหัส)`}
        detail={data.ruleCodes.map(cLabel).join(", ")}
      />
    );

  const rows = code ? data.cases.filter((c) => c.c_code === code) : data.cases;
  const of = code ? (data.summary.find((s) => s.c_code === code)?.n ?? rows.length) : data.total;
  return (
    <div className="flex flex-col gap-4">
      <CodeTable data={data} code={code} onCode={setCode} />
      <section aria-label="รายเคส" className="flex flex-col gap-2">
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-sm">
          <h3 className="font-semibold">รายเคส</h3>
          {code && <FilterChip label={cLabel(code)} onRemove={() => setCode("")} />}
          {rows.length < of && (
            <span className="text-warning tabular-nums">
              แสดง {formatCount(rows.length)} จาก {formatCount(of)} เคส (จำกัด {formatCount(data.cases.length)} แถวต่อครั้ง)
            </span>
          )}
        </div>
        <CaseTable rows={rows} file={data.file} />
      </section>
    </div>
  );
}

function Limits() {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
      <li>ตรวจได้ {RULE_CODE_COUNT} รหัส จากรหัส C ของ สปสช. เกือบ 700 รหัส ส่วนใหญ่เป็นข้อมูลผู้ป่วย (PAT) และผู้ป่วยใน (IPD) ไม่พบจึงไม่ได้แปลว่าจะไม่ติด C</li>
      <li>กฎ STP-… ({STP_COUNT} รหัส) ตรวจเฉพาะสิทธิ STP ตามรหัสตีกลับ (R) ของกองทุน ระดับเตือนและข้อมูลยังไม่ยืนยันว่ากองทุนตีกลับจริง</li>
      <li>รหัสที่ต้องเทียบกับฐานของ สปสช. ตรวจจากฝั่งโรงพยาบาลไม่ได้ เช่น C305 (Approve Code ไม่ตรง), C349 (ไม่พบ Authentication), C999 (ไม่พบสิทธิ)</li>
      <li>C160/C161 ตรวจไม่ได้ เพราะ HOSxP ของเราไม่มีข้อมูลประเภทบริการ (SVCTYPE)</li>
      <li>ค่าว่างถูกแทนด้วยค่าเริ่มต้นก่อนตรวจ (เพศ, ประเภทและสถานะการจำหน่าย) C103, C111, C112 จึงแทบไม่ขึ้น แม้ใน HOSxP จะว่างจริง</li>
    </ul>
  );
}

export function CCheck() {
  const url = useUrlParams(["type", "file"]);
  const type: FdhType = url.type === "ip" ? "ip" : "op";
  // แฟ้มที่ไม่มีในหมวดนี้ (เช่น เพิ่งสลับหมวด) ใช้แฟ้มแรกของหมวด
  const file = (FILE_ORDER[type] as readonly string[]).includes(url.file) ? url.file : FILE_ORDER[type][0];
  const { start, end } = useDateRange();
  const dateLabel = DATE_LABEL[type];

  // ยิง validate ก่อน: pool ของ his มี 3 connection แฟ้มที่เปิดอยู่จึงได้คิวก่อน statement นับแถวทุกแฟ้มของ summary
  const result = useJson<ValidateResponse>(`/api/fdh/c-check/validate?${new URLSearchParams({ type, file, start, end })}`);
  const summary = useJson<SummaryResponse>(`/api/fdh/c-check/summary?${new URLSearchParams({ type, start, end })}`);
  const d = result.data;
  // มีเคสเท่านั้น ส่วนสถานะอื่น (ไม่พบ/ไม่มีกฎ/ไม่มีข้อมูล) บอกใน Notice แล้ว
  const stat = d && d.total > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented label="หมวด" options={TYPE_OPTIONS} value={type} onChange={(t) => url.set({ type: t, file: (FILE_ORDER[t] as readonly string[]).includes(file) ? file : null })} />
        <div role="group" aria-label={dateLabel} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{dateLabel}</span>
          <DateRangeFilter />
        </div>
      </div>

      {summary.error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          นับจำนวนเคสของแต่ละแฟ้มไม่สำเร็จ: {summary.error}
          <button type="button" onClick={summary.retry} className={btn}>
            ลองใหม่
          </button>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:items-start">
        <FileTabs type={type} file={file} summary={summary.data} loading={summary.loading} onSelect={(f) => url.set({ file: f })} />

        <section aria-labelledby="fdh-file" aria-busy={result.loading} className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-7 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="fdh-file" className="text-title">
              แฟ้ม {file}
            </h2>
            {d && (
              <p className="text-sm text-muted tabular-nums">
                <span className="font-semibold text-foreground">{formatCount(d.rows)}</span> แถว
                {stat && (
                  <>
                    <span aria-hidden="true"> · </span>พบ{" "}
                    <span className={`font-semibold ${d.total ? "text-danger" : "text-foreground"}`}>{formatCount(d.total)}</span> เคส ใน{" "}
                    <span className="font-semibold text-foreground">{formatCount(d.summary.length)}</span> รหัส
                    <span aria-hidden="true"> · </span>ตรวจ {formatCount(d.ruleCodes.length)} รหัส
                  </>
                )}
              </p>
            )}
          </div>

          {result.loading ? (
            <Skeleton rows={6} />
          ) : result.error ? (
            <div role="alert">
              <Notice
                title="ตรวจไม่สำเร็จ"
                detail={result.error}
                action={
                  <button type="button" onClick={result.retry} className={btn}>
                    ลองใหม่
                  </button>
                }
              />
            </div>
          ) : (
            d && <Result key={`${d.type}|${d.file}|${start}|${end}`} data={d} dateLabel={dateLabel} />
          )}

          <Limits />
        </section>
      </div>
    </div>
  );
}
