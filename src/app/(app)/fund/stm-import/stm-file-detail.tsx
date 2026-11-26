"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { StmFileDetail } from "@/app/api/fund/stm-import/detail/route";
import type { StmHsubDetail, StmHsubImportResult } from "@/app/api/fund/stm-import/hsub/route";
import { Money, Skeleton, btn, num, useJson } from "../_components/ui";
import { FUNDS, SCHEMES, SECTIONS, isCalc, periodLabel, runBadge } from "./labels";

const dash = <span className="text-muted">–</span>;
const th = "px-3 py-1.5 font-medium whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const tableBox = "overflow-x-auto rounded-lg border border-line";
const dateTime = (v: string | null) => (v ? `${formatThaiDate(v)} ${v.slice(11, 16)}` : null);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 break-words tabular-nums">{children || dash}</dd>
  </div>
);

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 px-3 py-2">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
  </div>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const smallBtn = "inline-flex h-7 items-center rounded-md border px-2.5 font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50";
const cents = (n: number | string) => Math.round(Number(n) * 100);

/** ยอดต่อ รพ.สต. รวมทุก REP/ส่วน (สตางค์) */
function byHcode(rows: StmHsubDetail["rows"]) {
  const out = new Map<string, { hcode: string; name: string | null; cases: number; net: number; funds: Map<string, number> }>();
  for (const r of rows) {
    const g = out.get(r.hcode) ?? { hcode: r.hcode, name: r.name, cases: 0, net: 0, funds: new Map() };
    out.set(r.hcode, g);
    g.cases += r.cases;
    g.net += cents(r.net);
    for (const [f, v] of Object.entries(r.amounts)) g.funds.set(f, (g.funds.get(f) ?? 0) + cents(v));
  }
  return [...out.values()].sort((a, b) => a.hcode.localeCompare(b.hcode));
}

/** รายงานพึงจ่าย รพ.สต. (Hsub) ของไฟล์ STM UC OP: เก็บเฉพาะยอดรวม นำเข้า/นำเข้าใหม่ได้ทุกคน ลบเฉพาะ admin */
function HsubSection({ id, admin }: { id: string; admin: boolean }) {
  const query = new URLSearchParams({ stm_file_id: id });
  const { loading, data, error, retry } = useJson<StmHsubDetail>(`/api/fund/stm-import/hsub?${query}`);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // นำเข้า (POST) หรือลบ (DELETE) แล้วโหลดส่วนนี้ใหม่
  function send(url: string, init: RequestInit, done: (body: StmHsubImportResult | null) => string) {
    setMsg(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await fetch(url, init).catch(() => null);
      const body: StmHsubImportResult | null = res && res.status !== 204 ? await res.json().catch(() => null) : null;
      if (!res?.ok) {
        setMsg({ ok: false, text: (body && "error" in body && body.error) || (res ? `ไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้") });
        return;
      }
      setMsg({ ok: true, text: done(body) });
      retry();
    });
  }

  function upload(f: File) {
    const form = new FormData();
    form.append("stm_file_id", id);
    form.append("file", f);
    send("/api/fund/stm-import/hsub", { method: "POST", body: form }, (b) =>
      b && "status" in b ? (b.status === "duplicate" ? "ไฟล์นี้นำเข้าไว้แล้ว" : `นำเข้าแล้ว ${formatCount(b.cases)} ราย`) : "นำเข้าแล้ว",
    );
  }

  const file = data?.file;
  const groups = data ? byHcode(data.rows) : [];
  const fundKeys = Object.keys(FUNDS).filter((k) => file?.amounts[k]);

  return (
    <Section title="รายงานพึงจ่าย รพ.สต.">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {loading ? null : error ? (
          <span role="alert" className="text-danger">โหลดไม่สำเร็จ {error}</span>
        ) : file ? (
          <span className="min-w-0 break-words text-muted">
            {file.file_name} · นำเข้า {dateTime(file.imported_at)}
            {file.imported_by ? ` โดย ${file.imported_by}` : ""}
          </span>
        ) : (
          <span className="text-muted">ยังไม่นำเข้า</span>
        )}
        <label className={`${smallBtn} cursor-pointer gap-1.5 border-line bg-surface hover:bg-hover has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:pointer-events-none has-disabled:opacity-50`}>
          <Upload className="size-3.5" aria-hidden="true" />
          {file ? "นำเข้าใหม่" : "เลือกไฟล์"}
          <input
            type="file"
            accept=".xls"
            aria-label={file ? "นำเข้ารายงานพึงจ่าย รพ.สต. ใหม่" : "เลือกไฟล์รายงานพึงจ่าย รพ.สต."}
            className="sr-only"
            disabled={pending || loading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
        {admin &&
          file &&
          (confirming ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => send(`/api/fund/stm-import/hsub?${query}`, { method: "DELETE" }, () => "ลบแล้ว")}
                className={`${smallBtn} border-transparent bg-danger text-accent-fg hover:bg-danger/90`}
              >
                ยืนยันลบ
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={`${smallBtn} border-line bg-surface hover:bg-hover`}>
                ยกเลิก
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirming(true)} aria-label="ลบรายงานพึงจ่าย รพ.สต." className={`${smallBtn} border-line bg-surface text-danger hover:bg-hover`}>
              ลบ
            </button>
          ))}
        {pending && <span className="text-muted">กำลังบันทึก…</span>}
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-danger"}>
            {msg.text}
          </span>
        )}
      </div>

      {file && (
        <div className={`${tableBox} mt-3`}>
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className={th}>รพ.สต.</th>
                <th className={`${th} ${num}`}>ราย</th>
                {fundKeys.map((k) => (
                  <th key={k} className={`${th} ${num}`}>{FUNDS[k]} (บาท)</th>
                ))}
                <th className={`${th} ${num}`}>รวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.hcode} className="border-t border-line">
                  <td className={td}>
                    {g.name ?? g.hcode}
                    {g.name && <span className="ml-1.5 text-xs text-muted">{g.hcode}</span>}
                  </td>
                  <td className={`${td} ${num}`}>{formatCount(g.cases)}</td>
                  {fundKeys.map((k) => (
                    <td key={k} className={`${td} ${num}`}>{formatBaht((g.funds.get(k) ?? 0) / 100)}</td>
                  ))}
                  <td className={`${td} ${num}`}>{formatBaht(g.net / 100)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className={td}>รวม</td>
                <td className={`${td} ${num}`}>{formatCount(file.cases)}</td>
                {fundKeys.map((k) => (
                  <td key={k} className={`${td} ${num}`}>{formatBaht(file.amounts[k])}</td>
                ))}
                <td className={`${td} ${num}`}>{formatBaht(Number(file.net_total))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** เนื้อหา modal ของไฟล์ STM หนึ่งไฟล์: สรุปราย REP และยอดรายกองทุนจากชีตสรุป ; UC OP มีส่วนรายงานพึงจ่าย รพ.สต. */
export function StmFileDetailView({ id, admin }: { id: string; admin: boolean }) {
  const { loading, data, error, retry } = useJson<StmFileDetail>(`/api/fund/stm-import/detail?${new URLSearchParams({ id })}`);

  if (loading) return <Skeleton rows={8} />;
  if (error || !data)
    return (
      <div className="py-6 text-center text-sm">
        <p className="font-medium text-danger">โหลดรายละเอียดไฟล์ไม่สำเร็จ</p>
        <p className="mt-1 text-muted">{error}</p>
        <button type="button" onClick={retry} className={`${btn} mt-4`}>ลองอีกครั้ง</button>
      </div>
    );

  const { file: f, reps, funds } = data;
  const showSection = reps.some((r) => r.section !== "normal");
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-6 gap-y-3">
        <Fact label="งวด">
          {periodLabel(f.period_month)}
          <span className={runBadge}>งวด {f.run_no}</span>
        </Fact>
        <Fact label="สิทธิ">{`${SCHEMES[f.scheme] ?? f.scheme} ${f.patient_type}`}</Fact>
        <Fact label="HCODE">{f.hcode}</Fact>
        <Fact label="วันที่ออก STM">{formatThaiDate(f.transfer_date)}</Fact>
        <Fact label="วันที่ออกรายงาน">{dateTime(f.printed_at)}</Fact>
        <Fact label="นำเข้าเมื่อ">{dateTime(f.imported_at)}</Fact>
        <Fact label="ผู้นำเข้า">{f.imported_by}</Fact>
        <Fact label="ชื่อไฟล์">{f.file_name}</Fact>
      </dl>

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] rounded-lg border border-line bg-surface-sunken">
        <Kpi label="จำนวนรายการ" value={formatCount(f.row_count)} />
        <Kpi label="ยอดชดเชย (บาท)" value={formatBaht(Number(f.paid_total))} />
        <Kpi label="หัก (บาท)" value={formatBaht(Number(f.deduction))} />
        <Kpi label="ยอดโอนสุทธิ (บาท)" value={formatBaht(Number(f.net_total))} />
      </dl>

      <Section title="สรุปราย REP">
        <div className={tableBox}>
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                {showSection && <th className={th}>ประเภท</th>}
                <th className={th}>REP</th>
                <th className={`${th} ${num}`}>ราย</th>
                <th className={`${th} ${num}`}>เรียกเก็บ (บาท)</th>
                <th className={`${th} ${num}`}>ชดเชย (บาท)</th>
                {f.scheme === "UCS" && <th className={th}>แหล่งข้อมูล</th>}
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={`${r.section}-${r.rep_no}`} className="border-t border-line">
                  {showSection && <td className={`${td} whitespace-nowrap`}>{SECTIONS[r.section]}</td>}
                  <td className={td}>{r.rep_no}</td>
                  <td className={`${td} ${num}`}>{r.passed === null ? dash : formatCount(r.passed)}</td>
                  <td className={`${td} ${num}`}><Money value={r.claim_total === null ? null : Number(r.claim_total)} /></td>
                  <td className={`${td} ${num}`}>{formatBaht(Number(r.paid_total))}</td>
                  {f.scheme === "UCS" && <td className={td}>{r.source ?? dash}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="ยอดรายกองทุน">
        {funds.length ? (
          <div className={tableBox}>
            <table className="w-full border-collapse tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className={th}>กองทุน</th>
                  <th className={`${th} ${num}`}>ยอด (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((g) => (
                  // ยอดคำนวณได้แสดงจาง เพราะไม่รวมในยอดชดเชย
                  <tr key={g.fund} className={`border-t border-line ${isCalc(g.fund) ? "text-muted" : ""}`}>
                    <td className={td}>{FUNDS[g.fund] ?? g.fund}</td>
                    <td className={`${td} ${num}`}>{formatBaht(Number(g.amount))}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className={td}>รวม</td>
                  <td className={`${td} ${num}`}>{formatBaht(Number(f.paid_total))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">ไม่มียอดชดเชย</p>
        )}
      </Section>

      {f.scheme === "UCS" && f.patient_type === "OP" && <HsubSection id={id} admin={admin} />}
    </div>
  );
}
