"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "@/app/(app)/fund/_components/ui";
import type { ClaimCodesData } from "@/app/api/fdh/claim-codes/route";
import { KIND_SCOPE, PROBLEM_TEXT, type ClaimKind, type ItemRow } from "@/app/api/fdh/claim-codes/readiness";

const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const KINDS: ClaimKind[] = ["INST", "PP"];

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Section({ title, count, tone, kind, part, children }: { title: string; count: number; tone?: "danger" | "warning"; kind: ClaimKind; part: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">
          {title} <span className={tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted"}>{formatCount(count)}</span>
        </h2>
        {count > 0 && (
          <a href={`/api/fdh/claim-codes?${new URLSearchParams({ kind, format: "xlsx", part })}`} download className={btn}>
            ส่งออก Excel
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

const match = (q: string, ...v: (string | null)[]) => !q || v.some((x) => x?.toLowerCase().includes(q));

function ItemTable({ rows, showProblem }: { rows: ItemRow[]; showProblem: boolean }) {
  return (
    <Table
      head={
        <>
          <th className={TH}>รหัส HOSxP</th>
          <th className={TH}>ชื่อรายการ</th>
          <th className={TH}>หมวดรายรับ</th>
          <th className={TH}>รหัส สปสช.</th>
          {showProblem && <th className={TH}>ปัญหา / วิธีแก้</th>}
          <th className={`${TH} ${num}`}>ใช้ 30 วัน (ครั้ง)</th>
          <th className={`${TH} ${num}`}>มูลค่า 30 วัน (บาท)</th>
        </>
      }
    >
      {rows.map((r) => (
        <tr key={r.icode} className="border-t border-line hover:bg-surface-sunken">
          <td className={`${TD} tabular-nums`}>{r.icode}</td>
          <td className={`${TD} min-w-56`}>{r.name}</td>
          <td className={`${TD} tabular-nums`}>{r.income ?? "–"}</td>
          <td className={`${TD} tabular-nums`}>
            {r.adp ?? <span className="text-muted">–</span>}
            {r.adp_name && r.problem && <span className="block max-w-64 truncate text-xs text-muted" title={r.adp_name}>{r.adp_name}</span>}
          </td>
          {showProblem && r.problem && (
            <td className={`${TD} min-w-64`}>
              <span className={r.usage.n ? "text-danger" : "text-warning"}>{PROBLEM_TEXT[r.problem].label}</span>
              <span className="block text-xs text-muted">{PROBLEM_TEXT[r.problem].fix}</span>
            </td>
          )}
          <td className={`${TD} ${num}`}>{r.usage.n ? formatCount(r.usage.n) : <span className="text-muted">–</span>}</td>
          <td className={`${TD} ${num}`}><Money value={r.usage.n ? r.usage.amount : null} /></td>
        </tr>
      ))}
    </Table>
  );
}

export function ClaimCodes() {
  const { kind: raw, set } = useUrlParams(["kind"]);
  const kind: ClaimKind = raw === "PP" ? "PP" : "INST";
  const { data, error, loading, retry } = useJson<ClaimCodesData>(`/api/fdh/claim-codes?${new URLSearchParams({ kind })}`);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const d = data && data.kind === kind ? data : undefined;
  const usedFix = d?.fix.filter((r) => r.usage.n > 0).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">ความพร้อมรหัสเบิก</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="กองทุน" className="inline-flex rounded-md border border-line p-0.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === kind}
                onClick={() => set({ kind: k === "INST" ? null : k })}
                className={`h-8 rounded px-3 text-sm font-medium ${focusRing} ${k === kind ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover"}`}
              >
                {KIND_SCOPE[k].label}
              </button>
            ))}
          </div>
          <label className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <input type="search" aria-label="ค้นหารหัสหรือชื่อรายการ" value={q} onChange={(e) => setQ(e.target.value)} className={`h-9 w-56 rounded-md border border-line bg-surface pr-3 pl-8 text-sm ${focusRing}`} />
          </label>
        </div>
      </div>

      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !d || loading ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {[
              ["รายการใน HOSxP ที่ต้องแก้", formatCount(d.fix.length), d.fix.length ? "text-danger" : ""],
              ["ในจำนวนนี้มีการใช้ 30 วัน", formatCount(usedFix), usedFix ? "text-danger" : ""],
              ["รหัสที่เบิกได้มีรายการใน HOSxP", `${formatCount(d.mappedCodes)} / ${formatCount(d.refTotal)}`, ""],
              ["รายการที่ตั้งรหัสถูกแล้ว", formatCount(d.ok.length), ""],
            ].map(([label, value, tone]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-muted">{label}</dt>
                <dd className={`text-title tabular-nums ${tone}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            รายการอ้างอิง: {d.source} · การใช้งาน {formatThaiDate(d.usageFrom)} ถึง {formatThaiDate(d.usageTo)} · แก้รหัสในรายการค่าบริการ/ยาของ HOSxP แล้วหน้านี้จะอัปเดตเอง
          </p>

          <Section title="รายการใน HOSxP ที่ต้องแก้" count={d.fix.length} tone="danger" kind={kind} part="fix">
            {d.fix.length === 0 ? <p className="text-sm text-muted">ทุกรายการในหมวดนี้ตั้งรหัสถูกแล้ว</p> : (
              <ItemTable rows={d.fix.filter((r) => match(query, r.icode, r.name, r.adp))} showProblem />
            )}
          </Section>

          <Section title="รหัสที่เบิกได้แต่ยังไม่มีรายการใน HOSxP" count={d.missing.length} tone="warning" kind={kind} part="missing">
            <p className="text-xs text-muted">ไม่จำเป็นต้องมีครบทุกรหัส ให้ตรวจเฉพาะบริการที่โรงพยาบาลให้จริง</p>
            <details className="text-sm">
              <summary className="cursor-pointer py-1 text-accent-text">แสดงรายการ</summary>
              <div className="mt-2">
                <Table
                  head={
                    <>
                      <th className={TH}>รหัส สปสช.</th>
                      <th className={TH}>ชื่อ</th>
                      <th className={`${TH} ${num}`}>อัตราจ่าย (บาท)</th>
                    </>
                  }
                >
                  {d.missing.filter((m) => match(query, m.code, m.name)).map((m) => (
                    <tr key={m.code} className="border-t border-line hover:bg-surface-sunken">
                      <td className={`${TD} tabular-nums`}>{m.code}</td>
                      <td className={TD}>{m.name ?? <span className="text-muted">–</span>}</td>
                      <td className={`${TD} ${num}`}><Money value={m.rate} /></td>
                    </tr>
                  ))}
                </Table>
              </div>
            </details>
          </Section>

          <Section title="รายการที่ตั้งรหัสถูกแล้ว" count={d.ok.length} kind={kind} part="ok">
            <details className="text-sm">
              <summary className="cursor-pointer py-1 text-accent-text">แสดงรายการ</summary>
              <div className="mt-2">
                <ItemTable rows={d.ok.filter((r) => match(query, r.icode, r.name, r.adp))} showProblem={false} />
              </div>
            </details>
          </Section>
        </>
      )}
    </div>
  );
}
