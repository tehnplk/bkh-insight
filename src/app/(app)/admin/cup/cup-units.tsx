"use client";

import { useState, useTransition } from "react";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Notice, Skeleton, btn, focusRing, useJson } from "@/app/(app)/fund/_components/ui";
import type { CupData, CupUnit } from "@/app/api/admin/cup/route";

const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const INPUT = `h-9 min-w-0 rounded-md border border-line bg-surface px-3 ${focusRing}`;
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const SOURCE: Record<CupUnit["source"], string> = { default: "ค่าเริ่มต้น", include: "เพิ่มเอง", exclude: "นำออกแล้ว" };
const dash = <span className="text-muted">–</span>;

async function send(method: "POST" | "DELETE", hcode: string, note = ""): Promise<string | null> {
  const res = await fetch("/api/admin/cup", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hcode, note }) }).catch(() => null);
  if (res?.ok) return null;
  const body = await res?.json().catch(() => null);
  return body?.error ?? `บันทึกไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}`;
}

function AddForm({ onDone }: { onDone: (msg: string) => void }) {
  const [hcode, setHcode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        startTransition(async () => {
          const err = await send("POST", hcode.trim(), note);
          if (err) return setError(err);
          setHcode("");
          setNote("");
          onDone(`เพิ่ม ${hcode.trim()} เข้า CUP แล้ว`);
        });
      }}
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-muted">HCODE</span>
        <input
          required
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          value={hcode}
          onChange={(e) => setHcode(e.target.value)}
          aria-describedby={error ? "cup-add-error" : undefined}
          className={`${INPUT} w-28 tabular-nums`}
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-sm">
        <span className="text-muted">หมายเหตุ</span>
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </label>
      <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังเพิ่ม…" : "เพิ่มเข้า CUP"}</button>
      {error && <p id="cup-add-error" role="alert" className="basis-full text-danger">{error}</p>}
    </form>
  );
}

function RowAction({ unit, own, onDone }: { unit: CupUnit; own: string; onDone: (msg: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  if (unit.hcode === own) return <span className="text-xs text-muted">โรงพยาบาลเอง</span>;
  const restore = unit.source === "exclude";
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const err = await send(restore ? "POST" : "DELETE", unit.hcode);
            if (err) return setError(err);
            onDone(restore ? `คืน ${unit.hcode} เข้า CUP แล้ว` : `นำ ${unit.hcode} ออกจาก CUP แล้ว`);
          })
        }
        className={`${btn} h-7 px-2.5 disabled:cursor-wait disabled:opacity-60`}
      >
        {restore ? "คืนเข้า CUP" : "นำออก"}
      </button>
      {error && <span role="alert" className="block text-xs text-danger">{error}</span>}
    </>
  );
}

export function CupUnits() {
  const { data, error, retry } = useJson<CupData>("/api/admin/cup");
  const [done, setDone] = useState("");
  const finish = (msg: string) => {
    setDone(msg);
    retry();
  };
  if (error) return <Notice title={`โหลดหน่วยบริการไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  if (!data) return <Skeleton rows={6} />;
  const inCup = data.units.filter((u) => u.source !== "exclude").length;

  return (
    <>
      <AddForm onDone={finish} />
      {done && <p role="status" className="text-sm text-success">{done}</p>}
      <section className="flex flex-col gap-2">
        <h2 className="text-title">
          หน่วยบริการ <span className="font-normal text-muted tabular-nums">{formatCount(inCup)} แห่ง</span>
        </h2>
        <div className="relative overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface text-left text-grid-head text-muted">
              <tr>
                <th scope="col" className={TH}>HCODE</th>
                <th scope="col" className={TH}>ชื่อหน่วยบริการ</th>
                <th scope="col" className={TH}>ที่มา</th>
                <th scope="col" className={TH}>หมายเหตุ</th>
                <th scope="col" className={TH}>ปรับโดย</th>
                <th scope="col" className={TH}><span className="sr-only">จัดการ</span></th>
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.hcode} className={`border-t border-line hover:bg-surface-sunken ${u.source === "exclude" ? "text-muted" : ""}`}>
                  <th scope="row" className={`${TD} text-left font-medium tabular-nums`}>{u.hcode}</th>
                  <td className={TD}>{u.name ?? dash}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className={u.source === "include" ? "text-accent-text" : ""}>{SOURCE[u.source]}</span>
                  </td>
                  <td className={TD}>{u.note ?? dash}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {u.updated_by ? (
                      <>
                        {u.updated_by}
                        <span className="block text-xs text-muted tabular-nums">{`${formatThaiDate(u.updated_at)} ${u.updated_at?.slice(11, 16)} น.`}</span>
                      </>
                    ) : dash}
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <RowAction unit={u} own={data.own} onDone={finish} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
