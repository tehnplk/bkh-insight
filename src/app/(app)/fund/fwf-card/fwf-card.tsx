"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { RefreshCw, UserPlus } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { copyable } from "@/components/copy-button/copy-button";
import { PatientName } from "@/components/patient-name/patient-name";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { Segmented } from "@/app/(app)/quality/pending/segmented";
import { Money, btn, num, useUrlParams } from "../_components/ui";
import { POOL_START, defaultValidity } from "@/app/api/fund/fwf-card/fwf";
import type { RegisterPage, RegisterRow } from "@/app/api/fund/fwf-card/register/route";
import type { LookupResult } from "@/app/api/fund/fwf-card/lookup/route";
import { CardTypes, Holders, MonthEnd, PoolTab } from "./fwf-pool";
import { FIELD, Flag, MonthSelect, SELECT, Status, dash, monthLabel, primary, send } from "./shared";

const TABS = [
  { value: "register", label: "ทะเบียนบัตร" },
  { value: "pool", label: "เงินรับล่วงหน้า" },
  { value: "holders", label: "ใช้สิทธิต่อคน" },
  { value: "month-end", label: "ตัดหนี้สิ้นเดือน" },
  { value: "types", label: "ชนิดบัตร" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/* ---------- ทะเบียนบัตร ---------- */

const col = gridColumnHelper<RegisterRow>();
const nowrap = "whitespace-nowrap tabular-nums";
const filterable = { className: "whitespace-nowrap", filter: true } as const;
const columns = col.columns([
  col.accessor("sale_date", { header: "วันขาย", cell: (c) => formatThaiDate(c.getValue()), meta: { className: nowrap } }),
  col.accessor("hn", { header: "HN", meta: { className: nowrap } }),
  col.accessor("name", { header: "ชื่อ-สกุล", cell: (c) => <PatientName name={c.getValue()} /> }),
  col.accessor("type_label", { header: "ชนิดบัตร", meta: filterable }),
  col.accessor("valid_to", {
    header: "ใช้ได้",
    cell: (c) => <span className={nowrap}>{formatThaiDate(c.row.original.valid_from)} – {formatThaiDate(c.getValue())}</span>,
  }),
  col.accessor("pool_amount", {
    header: "เงินรับล่วงหน้า (บาท)",
    cell: (c) => (c.getValue() == null ? <Flag tone="warning">ยังไม่กำหนดยอด</Flag> : <Money value={Number(c.getValue())} />),
    meta: { className: num },
  }),
  col.accessor("usage", { header: "ใช้แล้ว (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("remaining", { header: "คงเหลือ (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("source", { header: "ที่มา", cell: (c) => (c.getValue() === "hosxp" ? "HOSxP" : "เพิ่มเอง"), meta: { ...filterable, filter: { format: (v: string) => (v === "hosxp" ? "HOSxP" : "เพิ่มเอง") } } }),
  col.accessor("has_receipt", {
    header: "ข้อสังเกต",
    enableSorting: false,
    cell: (c) => <CardFlags r={c.row.original} />,
  }),
  col.accessor("status", {
    header: "สถานะ",
    cell: (c) => (c.getValue() === "void" ? <Flag tone="muted" title={c.row.original.void_reason ?? undefined}>ยกเลิก</Flag> : "ใช้งาน"),
    meta: { ...filterable, filter: { format: (v: string) => (v === "void" ? "ยกเลิก" : "ใช้งาน") } },
  }),
]);

function CardFlags({ r }: { r: RegisterRow }) {
  const flags = [
    r.source === "hosxp" && r.has_receipt === false && <Flag key="r" tone="danger" title="visit นี้ไม่มีใบเสร็จสถานะ OK ใน HOSxP">ไม่มีใบเสร็จ</Flag>,
    r.paidst === "02" && <Flag key="p" tone="warning" title="รายการบัตรถูกบันทึกเป็นเบิกได้ (paidst 02) ไม่ใช่ชำระเงิน">paidst 02</Flag>,
    r.hosxp_missing && <Flag key="m" tone="danger" title="รอบดึงล่าสุดไม่พบรายการนี้ใน HOSxP แล้ว ตรวจแล้วยกเลิกบัตรถ้าไม่ได้ขายจริง">ไม่พบใน HOSxP</Flag>,
  ].filter(Boolean);
  return flags.length ? <span className="flex flex-wrap gap-1">{flags}</span> : dash;
}

function RegisterSummary({ data }: { data: RegisterPage }) {
  const s = data.summary;
  const flags = [
    s.flags.unset_pool > 0 && <Flag key="u" tone="warning">ยังไม่กำหนดยอด {formatCount(s.flags.unset_pool)} ใบ</Flag>,
    s.flags.no_receipt > 0 && <Flag key="r" tone="danger">ไม่มีใบเสร็จ {formatCount(s.flags.no_receipt)} ใบ</Flag>,
    s.flags.paidst02 > 0 && <Flag key="p" tone="warning">paidst 02 {formatCount(s.flags.paidst02)} ใบ</Flag>,
    s.flags.missing > 0 && <Flag key="m" tone="danger">ไม่พบใน HOSxP {formatCount(s.flags.missing)} ใบ</Flag>,
  ].filter(Boolean);
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">จำนวนบัตรต่อชนิด {monthLabel(s.month)}</caption>
          <thead className="bg-surface text-left text-grid-head text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">ชนิดบัตร</th>
              <th scope="col" className="px-3 py-2 font-medium">icode / ราคา (บาท)</th>
              <th scope="col" className={`px-3 py-2 font-medium ${num}`}>เงินรับล่วงหน้าต่อใบ (บาท)</th>
              <th scope="col" className={`px-3 py-2 font-medium ${num}`}>จาก HOSxP</th>
              <th scope="col" className={`px-3 py-2 font-medium ${num}`}>เพิ่มเอง</th>
              <th scope="col" className={`px-3 py-2 font-medium ${num}`}>รวม (ใบ)</th>
              <th scope="col" className={`px-3 py-2 font-medium ${num}`}>ยกเลิก</th>
            </tr>
          </thead>
          <tbody>
            {s.types.map((t) => (
              <tr key={t.card_type_id} className="border-t border-line">
                <th scope="row" className="px-3 py-1.5 text-left font-medium">{t.label}</th>
                <td className="px-3 py-1.5 text-muted">{t.icode} / {formatBaht(Number(t.unit_price))}</td>
                <td className={`px-3 py-1.5 ${num}`}>{t.pool_amount == null ? <Flag tone="warning">ยังไม่กำหนด</Flag> : formatBaht(Number(t.pool_amount))}</td>
                <td className={`px-3 py-1.5 ${num}`}>{formatCount(t.hosxp)}</td>
                <td className={`px-3 py-1.5 ${num}`}>{formatCount(t.manual)}</td>
                <td className={`px-3 py-1.5 font-semibold ${num}`}>{formatCount(t.hosxp + t.manual)}</td>
                <td className={`px-3 py-1.5 text-muted ${num}`}>{formatCount(t.void)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-muted">
        <span><span className="font-semibold text-foreground">{formatCount(data.total)}</span> รายการ</span>
        {s.synced_at ? <span>ดึงจาก HOSxP {formatThaiDate(s.synced_at)} {s.synced_at.slice(11, 16)} น.</span> : <Flag tone="warning">ยังไม่ได้ดึงเดือนนี้จาก HOSxP</Flag>}
        {flags}
      </p>
    </div>
  );
}

function CardDetail({ row, onChanged }: { row: RegisterRow; onChanged: (text: string) => void }) {
  const [from, setFrom] = useState(row.valid_from);
  const [to, setTo] = useState(row.valid_to);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const run = (body: unknown, done: string) =>
    startTransition(async () => {
      setResult(undefined);
      const r = await send("/api/fund/fwf-card/card", "PATCH", body);
      if (!r.ok) return setResult({ ok: false, text: r.error });
      onChanged(done);
    });
  const active = row.status === "active";
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">ชื่อ-สกุล</dt><dd>{row.name ?? dash}</dd>
        <dt className="text-muted">ชนิดบัตร</dt><dd>{row.type_label} <span className="text-muted">({row.icode} ราคา {formatBaht(Number(row.unit_price))} × {formatCount(row.qty)})</span></dd>
        <dt className="text-muted">วันขาย</dt><dd>{formatThaiDate(row.sale_date)}{row.vn && <span className="text-muted"> · VN {copyable(row.vn, "VN")}</span>}</dd>
        <dt className="text-muted">ที่มา</dt><dd>{row.source === "hosxp" ? "HOSxP" : `เพิ่มเองโดย ${row.created_by}`}</dd>
        <dt className="text-muted">เงินรับล่วงหน้า (บาท)</dt><dd className="tabular-nums">{row.pool_amount == null ? <Flag tone="warning">ชนิดบัตรยังไม่กำหนดยอด</Flag> : formatBaht(Number(row.pool_amount))}</dd>
        <dt className="text-muted">ใช้แล้ว / โอนเงินบำรุง (บาท)</dt><dd className="tabular-nums">{formatBaht(row.usage)} / {formatBaht(row.released)}</dd>
        <dt className="text-muted">คงเหลือ (บาท)</dt><dd className="font-semibold tabular-nums"><Money value={row.remaining} />{row.loss ? <span className="ml-2 font-normal text-danger">ใช้เกิน {formatBaht(row.loss)}</span> : null}</dd>
        <dt className="text-muted">ข้อสังเกต</dt><dd><CardFlags r={row} /></dd>
        {!active && <><dt className="text-muted">ยกเลิก</dt><dd>{row.void_reason}{row.updated_by && <span className="text-muted"> · {row.updated_by}</span>}</dd></>}
      </dl>
      {active && (
        <>
          <form
            className="flex flex-col gap-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              run({ id: row.id, action: "validity", valid_from: from, valid_to: to }, `แก้วันใช้ได้ของบัตร HN ${row.hn} แล้ว`);
            }}
          >
            <h3 className="font-semibold">วันใช้ได้</h3>
            <div className="flex flex-wrap items-end gap-3">
              <ThaiDatePicker label="เริ่ม" value={from} onChange={setFrom} stepper={false} />
              <ThaiDatePicker label="หมดอายุ" value={to} onChange={setTo} min={from} stepper={false} />
              <button type="submit" disabled={pending || (from === row.valid_from && to === row.valid_to)} className={btn + " disabled:opacity-50"}>บันทึกวันที่</button>
            </div>
          </form>
          <form
            className="flex flex-col gap-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              run({ id: row.id, action: "void", reason }, `ยกเลิกบัตร HN ${row.hn} แล้ว`);
            }}
          >
            <h3 className="font-semibold">ยกเลิกบัตร</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-muted">เหตุผล</span>
                <input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} min-w-56`} />
              </label>
              <button type="submit" disabled={pending || !reason.trim()} className={`${btn} text-danger disabled:opacity-50`}>ยกเลิกบัตร</button>
            </div>
          </form>
        </>
      )}
      <Status result={result} />
    </div>
  );
}

function AddCard({ onAdded }: { onAdded: (text: string) => void }) {
  const [hn, setHn] = useState("");
  const [data, setData] = useState<LookupResult>();
  const [typeId, setTypeId] = useState("");
  const [sale, setSale] = useState(todayIso);
  const [validity, setValidity] = useState<{ from: string; to: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const type = data?.types.find((t) => t.id === typeId);
  const def = type ? defaultValidity(sale, type.months) : null;
  const from = validity?.from ?? def?.valid_from ?? sale, to = validity?.to ?? def?.valid_to ?? sale;

  function lookup() {
    startTransition(async () => {
      setResult(undefined);
      const res = await fetch(`/api/fund/fwf-card/lookup?${new URLSearchParams({ hn: hn.trim() })}`).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        setData(undefined);
        return setResult({ ok: false, text: body?.error ?? "ค้นหาไม่สำเร็จ" });
      }
      setData(body);
    });
  }
  const add = (body: unknown) =>
    startTransition(async () => {
      setResult(undefined);
      const r = await send("/api/fund/fwf-card/card", "POST", body);
      if (!r.ok) return setResult({ ok: false, text: r.error });
      onAdded(`เพิ่มบัตรของ HN ${data?.patient.hn} แล้ว`);
    });

  return (
    <div className="flex flex-col gap-4 text-sm">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-muted">HN</span>
          <input required inputMode="numeric" pattern="\d{1,9}" value={hn} onChange={(e) => setHn(e.target.value)} className={`${FIELD} w-36 tabular-nums`} />
        </label>
        <button type="submit" disabled={pending} className={btn}>ค้นหา</button>
      </form>
      {data && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted">HN</dt><dd className="tabular-nums">{copyable(data.patient.hn, "HN")}</dd>
            <dt className="text-muted">ชื่อ-สกุล</dt><dd className="font-medium">{data.patient.display_name || dash}</dd>
            <dt className="text-muted">อายุ</dt><dd>{data.patient.age_y == null ? dash : `${data.patient.age_y} ปี`}</dd>
            <dt className="text-muted">สัญชาติ</dt><dd>{data.patient.nationality_name ?? data.patient.nationality ?? dash}</dd>
          </dl>
          <MiniTable caption="visit ล่าสุด" head={["วันที่", "VN", "สิทธิ"]} rows={data.visits.map((v) => [formatThaiDate(v.vstdate), v.vn, `${v.pttype ?? ""} ${v.pttype_name ?? ""}`])} empty="ไม่มี visit" />
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">รายการขายบัตรใน HOSxP</h3>
            {data.sales.length === 0 ? (
              <p className="text-muted">ไม่พบรายการขายบัตรของ HN นี้</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {data.sales.map((s) => (
                  <li key={s.hos_guid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="tabular-nums">
                      {formatThaiDate(s.vstdate)} · {s.icode} ราคา {formatBaht(Number(s.unitprice))} × {formatCount(s.qty)}
                      {s.paidst === "02" && <> <Flag tone="warning">paidst 02</Flag></>}
                      <span className="block text-xs text-muted">{s.type_label ?? "ไม่ตรงกับชนิดบัตร (เช่น ค่าตรวจสุขภาพ)"}</span>
                    </span>
                    {s.card_id ? <span className="text-muted">อยู่ในทะเบียนแล้ว</span> : s.type_id ? (
                      <button type="button" disabled={pending} onClick={() => add({ hn: data.patient.hn, hos_guid: s.hos_guid })} className={btn}>เพิ่มเข้าทะเบียน</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <MiniTable
            caption="บัตรในทะเบียน"
            head={["วันขาย", "ชนิดบัตร", "ใช้ได้", "ที่มา", "สถานะ"]}
            rows={data.cards.map((c) => [formatThaiDate(c.sale_date), c.type_label, `${formatThaiDate(c.valid_from)} – ${formatThaiDate(c.valid_to)}`, c.source === "hosxp" ? "HOSxP" : "เพิ่มเอง", c.status === "void" ? "ยกเลิก" : "ใช้งาน"])}
            empty="ยังไม่มีบัตรในทะเบียน"
          />
          <form
            className="flex flex-col gap-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              add({ hn: data.patient.hn, card_type_id: typeId, sale_date: sale, valid_from: from, valid_to: to });
            }}
          >
            <h3 className="font-semibold">เพิ่มบัตรเอง</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-muted">ชนิดบัตร</span>
                <select required value={typeId} onChange={(e) => (setTypeId(e.target.value), setValidity(null))} className={SELECT}>
                  <option value="" disabled>เลือก</option>
                  {data.types.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              <ThaiDatePicker label="วันขาย" value={sale} onChange={(v) => (setSale(v), setValidity(null))} min={POOL_START} max={todayIso()} stepper={false} />
              <ThaiDatePicker label="เริ่ม" value={from} onChange={(v) => setValidity({ from: v, to })} stepper={false} />
              <ThaiDatePicker label="หมดอายุ" value={to} onChange={(v) => setValidity({ from, to: v })} min={from} stepper={false} />
              <button type="submit" disabled={pending || !typeId} className={primary}>เพิ่มบัตร</button>
            </div>
          </form>
        </>
      )}
      <Status result={result} />
    </div>
  );
}

export function MiniTable({ caption, head, rows, empty }: { caption: string; head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{caption}</h3>
      {rows.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead className="bg-surface text-left text-grid-head text-muted">
              <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-3 py-1.5">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Register({ month, setMonth, syncing, onSync }: { month: string; setMonth: (m: string) => void; syncing: boolean; onSync: () => void }) {
  const [gridKey, setGridKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const done = (text: string) => {
    setAdding(false);
    setResult({ ok: true, text });
    setGridKey((k) => k + 1);
  };
  return (
    <div className="flex flex-col gap-3">
      <Status result={result} />
      <DataGrid<RegisterRow, RegisterPage>
        key={`${gridKey}:${syncing}`}
        endpoint="/api/fund/fwf-card/register"
        params={{ month }}
        columns={columns}
        getRowId={(r) => r.id}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSelect value={month} from={POOL_START} onChange={setMonth} />
            <button type="button" onClick={onSync} disabled={syncing} className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}>
              <RefreshCw aria-hidden className={`size-4 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`} />
              {syncing ? "กำลังดึง…" : "ดึงใหม่"}
            </button>
            <button type="button" onClick={() => setAdding(true)} className={`${btn} gap-1.5`}>
              <UserPlus aria-hidden className="size-4" />
              เพิ่มบัตร
            </button>
          </div>
        }
        renderSummary={(d) => <RegisterSummary data={d} />}
        exportPlacement="summary"
        renderDetail={(r) => <CardDetail row={r} onChanged={done} />}
        detailMode="modal"
        detailInColumn="name"
        detailTitle={(r) => <>HN {copyable(r.hn, "HN")} · {r.type_label}</>}
        hideable
      />
      <DetailModal open={adding} onClose={() => setAdding(false)} title="เพิ่มบัตร" size="medium">
        {adding && <AddCard onAdded={done} />}
      </DetailModal>
    </div>
  );
}

/* ---------- หน้า ---------- */

export function FwfCard({ isAdmin }: { isAdmin: boolean }) {
  const { tab, month, set } = useUrlParams(["tab", "month"]);
  const today = todayIso();
  const current: Tab = TABS.some((t) => t.value === tab && (t.value !== "types" || isAdmin)) ? (tab as Tab) : "register";
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState<string>();
  const regMonth = month && month >= POOL_START.slice(0, 7) && month <= today.slice(0, 7) ? month : today.slice(0, 7);

  // เปิดหน้า = ดึงเดือนที่ยังไม่เคยดึง + เดือนนี้/เดือนก่อน (route ข้ามถ้าเพิ่งดึง) ; "ดึงใหม่" = ดึงเดือนที่เลือกทันที
  const sync = (body: object) => {
    setSyncing(true);
    setSyncError(undefined);
    send("/api/fund/fwf-card/sync", "POST", body).then((r) => {
      if (!r.ok) setSyncError(r.error);
      setSyncing(false);
    });
  };
  useEffect(() => {
    let live = true;
    send("/api/fund/fwf-card/sync", "POST", {}).then((r) => {
      if (!live) return;
      if (!r.ok) setSyncError(r.error);
      setSyncing(false);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Segmented label="มุมมอง" options={TABS.filter((t) => t.value !== "types" || isAdmin)} value={current} onChange={(v) => set({ tab: v === "register" ? null : v, month: null })} />
      {syncError && <p role="alert" className="text-sm text-danger">ดึงรายการขายบัตรจาก HOSxP ไม่สำเร็จ: {syncError} · กดดึงใหม่อีกครั้งได้ รายการที่มีแล้วไม่ลงซ้ำ</p>}
      {current === "register" && <Register month={regMonth} setMonth={(m) => set({ month: m })} syncing={syncing} onSync={() => sync({ month: regMonth })} />}
      {current === "pool" && <PoolTab />}
      {current === "holders" && <Holders />}
      {current === "month-end" && <MonthEnd month={month} setMonth={(m) => set({ month: m })} />}
      {current === "types" && isAdmin && <CardTypes />}
    </div>
  );
}
